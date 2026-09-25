import { createApplication } from "../fixtures";
import { defaultWorkspace } from "../../lib/workspaces";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Application, User } from "@prisma/client";

const broker = vi.hoisted(() => ({ publish: vi.fn() }));
// Only the broker boundary is mocked: the actual route, ingestion transaction,
// Prisma client, migration and Postgres all run. Real RabbitMQ delivery and its
// 30s/2m/5m/15m retry timing remain manual E2E checks (see VERIFICATION.md), so
// CI stays deterministic and finishes in minutes without a hosted broker.
vi.mock("../../lib/queue/client", () => ({ publish: broker.publish }));
import { db } from "../../lib/db";
import { POST } from "../../app/api/v1/events/route";
import { ingest } from "../../lib/events";

let user: User;
let app: Application;
const body = { type: "order.shipped", idempotencyKey: "order-42", payload: { orderId: 42 } };
function request(data: unknown = body, key: string | null = app.currentApiKey, header = "authorization") {
  return new Request("http://localhost/api/v1/events", {
    method: "POST", headers: { "Content-Type": "application/json", ...(key ? { [header]: header === "authorization" ? `Bearer ${key}` : key } : {}) }, body: JSON.stringify(data),
  });
}
async function endpoint(eventTypes: string[], applicationId = app.id) {
  return db.endpoint.create({ data: { applicationId, url: "https://example.com/webhook", secret: "test-secret", eventTypes } });
}
beforeEach(async () => {
  vi.clearAllMocks(); broker.publish.mockResolvedValue(undefined);
  user = await db.user.create({ data: { email: `test-${randomUUID()}@example.com`, hashedPassword: "not-used-in-api-key-tests" } });
  app = await createApplication({ data: { workspaceId: await defaultWorkspace(user.id), name: "Integration test", currentApiKey: randomUUID() } });
});
afterEach(async () => {
  // Every test removes only its own rows, in FK order. No truncation of shared
  // tables or reliance on execution order; failures still enter this cleanup.
  if (user) {
    const applications = { workspace: { members: { some: { userId: user.id } } } };
    await db.deliveryAttempt.deleteMany({ where: { event: { application: applications } } });
    await db.delivery.deleteMany({ where: { event: { application: applications } } });
    await db.event.deleteMany({ where: { application: applications } });
    await db.endpoint.deleteMany({ where: { application: applications } });
    await db.application.deleteMany({ where: applications });
    await db.workspace.deleteMany({ where: { members: { some: { userId: user.id } } } });
    await db.user.delete({ where: { id: user.id } });
  }
  vi.restoreAllMocks();
});
afterAll(async () => { await db.$disconnect(); });
describe("POST /api/v1/events with migrated disposable Postgres", () => {
  it("accepts a valid API key and persists the event", async () => {
    const response = await POST(request()); expect(response.status).toBe(202);
    const event = await response.json();
    expect(event).toMatchObject({ applicationId: app.id, ...body });
    expect(await db.event.findUnique({ where: { id: event.id } })).toMatchObject(body);
    expect(broker.publish).not.toHaveBeenCalled();
  });
  it.each([null, "invalid-key"])("rejects missing/invalid API key %s without writing", async key => {
    expect((await POST(request(body, key))).status).toBe(401);
    expect(await db.event.count({ where: { applicationId: app.id } })).toBe(0);
    expect(broker.publish).not.toHaveBeenCalled();
  });
  it("also accepts the X-API-Key header", async () => expect((await POST(request(body, app.currentApiKey, "x-api-key"))).status).toBe(202));
  it("returns the original event for a repeated key, ignoring changed payload", async () => {
    await endpoint(["*"]);
    const first = await (await POST(request())).json();
    const response = await POST(request({ ...body, payload: { changed: true } }));
    expect(response.status).toBe(202); expect(await response.json()).toEqual(first);
    expect(await db.event.count({ where: { applicationId: app.id } })).toBe(1);
    expect(await db.delivery.count({ where: { eventId: first.id } })).toBe(1);
    expect(broker.publish).toHaveBeenCalledTimes(1);
  });
  it("deduplicates simultaneous submissions using the real unique constraint", async () => {
    await endpoint(["*"]);
    const responses = await Promise.all([POST(request()), POST(request())]);
    expect(responses.map(r => r.status)).toEqual([202, 202]);
    const events = await Promise.all(responses.map(r => r.json()));
    expect(events[0].id).toBe(events[1].id);
    expect(await db.delivery.count({ where: { eventId: events[0].id } })).toBe(1);
    expect(broker.publish).toHaveBeenCalledTimes(1);
  });
  it("does not deduplicate keys across applications", async () => {
    const other = await createApplication({ data: { workspaceId: await defaultWorkspace(user.id), name: "Other app", currentApiKey: randomUUID() } });
    const first = await (await POST(request())).json();
    const second = await (await POST(request(body, other.currentApiKey))).json();
    expect(first.id).not.toBe(second.id); expect(second.applicationId).toBe(other.id);
  });
  it("queues only exact/wildcard matches in the same application", async () => {
    const exact = await endpoint([body.type]); const wildcard = await endpoint(["*"]);
    await endpoint(["payment.failed"]);
    const other = await createApplication({ data: { workspaceId: await defaultWorkspace(user.id), name: "Other", currentApiKey: randomUUID() } });
    await endpoint(["*"], other.id);
    const response = await POST(request()); expect(response.status).toBe(202);
    const event = await response.json();
    const deliveries = await db.delivery.findMany({ where: { eventId: event.id } });
    expect(deliveries.map(d => d.endpointId).sort()).toEqual([exact.id, wildcard.id].sort());
    expect(broker.publish).toHaveBeenCalledTimes(2);
    for (const delivery of deliveries) {
      // null delayQueue selects webhook-relay / deliver; queue.test.ts verifies
      // those wire-level arguments and the persistent JSON message separately.
      expect(broker.publish).toHaveBeenCalledWith({ id: delivery.id, attemptNumber: 1 }, null);
      expect(delivery.publishedAt).toBeInstanceOf(Date);
      expect(delivery.status).toBe("PENDING");
    }
  });
  it("excludes synthetic endpoint tests from accepted-event and destination metering", async () => {
    const ep = await endpoint(["*"]);
    const synthetic = await ingest(app.id, { type: "hooka.test", payload: {}, idempotencyKey: `synthetic-${randomUUID()}` }, { endpointId: ep.id, synthetic: true });
    expect(synthetic.billable).toBe(false);
    expect(await db.workspaceUsageMonth.count({ where: { workspaceId: app.workspaceId } })).toBe(0);
    expect((await POST(request({ ...body, idempotencyKey: randomUUID() }))).status).toBe(202);
    const row = await db.workspaceUsageMonth.findFirstOrThrow({ where: { workspaceId: app.workspaceId } });
    expect(row).toMatchObject({ acceptedEvents: 1n, destinationDeliveries: 1n });
  });
  it("keeps the durable outbox intent when publishing fails", async () => {
    await endpoint(["*"]); broker.publish.mockRejectedValueOnce(new Error("broker offline"));
    const response = await POST(request()); expect(response.status).toBe(202);
    const event = await response.json();
    const delivery = await db.delivery.findFirstOrThrow({ where: { eventId: event.id } });
    expect(delivery.publishedAt).toBeNull(); expect(delivery.status).toBe("PENDING");
  });
  it("generates a UUID for omitted idempotency keys", async () => {
    const response = await POST(request({ type: body.type, payload: null }));
    expect(response.status).toBe(202); const event = await response.json();
    expect(event.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/); expect(event.payload).toBeNull();
  });
  it("rejects oversized payloads before insertion", async () => {
    expect((await POST(request({ ...body, payload: "x".repeat(262144) }))).status).toBe(413);
    expect(await db.event.count({ where: { applicationId: app.id } })).toBe(0);
  });
  it("rejects malformed JSON without inserting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(new Request("http://localhost/api/v1/events", { method: "POST", headers: { authorization: `Bearer ${app.currentApiKey}` }, body: "{broken" }));
    expect(response.status).toBe(400); expect(await db.event.count({ where: { applicationId: app.id } })).toBe(0);
  });
  it.each([{ ...body, type: "bad\nheader" }, { type: body.type }])("rejects invalid event body %#", async invalid => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(request(invalid))).status).toBe(400);
    expect(await db.event.count({ where: { applicationId: app.id } })).toBe(0);
  });
});
