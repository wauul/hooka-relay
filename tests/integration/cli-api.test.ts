import { defaultWorkspace } from "../../lib/workspaces";
import { beforeEach, afterEach, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("../../lib/security", () => ({ newSecret: () => "generated-endpoint-secret", resolveEndpoint: vi.fn(async (url: string) => { if (!url.startsWith("https://")) throw new Error("public HTTPS required"); }) }));
import { db } from "../../lib/db";
import { cliApi } from "../../lib/cli-api";
let userId: string;
let app: { id: string; currentApiKey: string };
let other: { id: string; currentApiKey: string };
const call = (path: string, method = "GET", body?: unknown, key: string | null = app.currentApiKey) => cliApi(new Request(`https://example.com/api/v1/${path}`, { method, headers: key ? { authorization: `Bearer ${key}` } : {}, body: body === undefined ? undefined : JSON.stringify(body) }), path.split("?")[0].split("/"));
beforeEach(async () => {
  userId = (await db.user.create({ data: { email: `${randomUUID()}@example.com`, hashedPassword: "test" } })).id;
  app = await db.application.create({ data: { workspaceId: await defaultWorkspace(userId), name: "CLI app", currentApiKey: randomUUID() } });
  other = await db.application.create({ data: { workspaceId: await defaultWorkspace(userId), name: "Other app", currentApiKey: randomUUID() } });
});
afterEach(async () => {
  const application = { workspace: { members: { some: { userId } } } };
  await db.deliveryAttempt.deleteMany({ where: { event: { application } } });
  await db.delivery.deleteMany({ where: { event: { application } } });
  await db.event.deleteMany({ where: { application } });
  await db.endpoint.deleteMany({ where: { application } });
  await db.application.deleteMany({ where: application });
  await db.workspace.deleteMany({ where: { members: { some: { userId } } } });
  await db.user.delete({ where: { id: userId } });
});
afterAll(() => db.$disconnect());
async function fixture(applicationId = app.id) {
  const endpoint = await db.endpoint.create({ data: { applicationId, url: "https://example.com/hook", secret: "private", eventTypes: ["*"] } });
  const event = await db.event.create({ data: { applicationId, type: "test.event", payload: {}, idempotencyKey: randomUUID() } });
  const delivery = await db.delivery.create({ data: { eventId: event.id, endpointId: endpoint.id, status: "DELIVERED" } });
  return { endpoint, event, delivery };
}
it("rejects absent and invalid keys", async () => {
  for (const key of [null, "invalid"]) expect((await call("me", "GET", undefined, key)).status).toBe(401);
});
it("returns identity without key or user information, without caching", async () => {
  const res = await call("me");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ application: { id: app.id, name: "CLI app", createdAt: expect.any(String) } });
});
it("lists only the key's endpoints and never discloses existing secrets", async () => {
  const own = await fixture(); await fixture(other.id);
  const data = await (await call("endpoints")).json();
  expect(data.endpoints).toHaveLength(1); expect(data.endpoints[0].id).toBe(own.endpoint.id);
  expect(data.endpoints[0]).not.toHaveProperty("secret"); expect(data.endpoints[0].successRate).toBeNull();
});
it("registers endpoints with a one-time secret and validates input", async () => {
  const res = await call("endpoints", "POST", { url: "https://example.com/cli", eventTypes: ["order.shipped"] });
  expect(res.status).toBe(201); expect((await res.json()).endpoint.secret).toBe("generated-endpoint-secret");
  expect((await call("endpoints", "POST", { url: "http://localhost", eventTypes: ["*"] })).status).toBe(400);
  expect((await call("endpoints", "POST", { url: "https://example.com", eventTypes: [] })).status).toBe(400);
});
it("denies status, replay and attempt access to a different application's resources", async () => {
  const f = await fixture(other.id);
  for (const [path, method] of [[`events/${f.event.id}`, "GET"], [`events/${f.event.id}/replay`, "POST"], [`attempts?endpoint=${f.endpoint.id}`, "GET"]]) expect((await call(path, method)).status).toBe(404);
  expect((await (await call("attempts")).json()).attempts).toEqual([]);
});
it("replays into a new generation without changing the old terminal run", async () => {
  const f = await fixture();
  const responses = await Promise.all([call(`events/${f.event.id}/replay`, "POST"), call(`events/${f.event.id}/replay`, "POST")]);
  const replays = await Promise.all(responses.map(r => r.json()));
  expect(replays.map(r => r.generation).sort()).toEqual([1, 2]);
  expect(replays[0].queued).toBe(1);
  const status = await (await call(`events/${f.event.id}?generation=1`)).json();
  expect(status.deliveries[0]).toMatchObject({ status: "PENDING", attempts: 0, generation: 1, lastAttempt: null });
  expect(status.deliveries[0].endpoint).not.toHaveProperty("secret");
  expect((await db.delivery.findUniqueOrThrow({ where: { id: f.delivery.id } })).status).toBe("DELIVERED");
});
it("reports actual attempts and 24-hour success excluding circuit skips", async () => {
  const f = await fixture();
  for (const status of ["SUCCESS", "FAILED", "SKIPPED_CIRCUIT_OPEN"] as const) await db.deliveryAttempt.create({ data: { eventId: f.event.id, endpointId: f.endpoint.id, deliveryId: f.delivery.id, attemptNumber: 1, status, httpStatusCode: status === "SUCCESS" ? 200 : null } });
  expect((await (await call("endpoints")).json()).endpoints[0].successRate).toBe(50);
  expect((await (await call(`events/${f.event.id}`)).json()).deliveries[0].attempts).toBe(2);
});
it("paginates attempts with tied timestamps without leaking body/headers", async () => {
  const f = await fixture();
  const createdAt = new Date();
  await db.deliveryAttempt.createMany({ data: Array.from({ length: 105 }, (_, i) => ({ id: `a${userId}${String(i).padStart(3, "0")}`, eventId: f.event.id, endpointId: f.endpoint.id, deliveryId: f.delivery.id, attemptNumber: 1, status: "SUCCESS" as const, createdAt, requestBody: "sensitive" })) });
  const after = Buffer.from(JSON.stringify({ time: createdAt.toISOString(), id: "" })).toString("base64url");
  const page = await (await call(`attempts?after=${after}`)).json();
  expect(page.attempts).toHaveLength(100); expect(page.hasMore).toBe(true);
  expect(page.attempts[0]).not.toHaveProperty("requestBody");
  const next = await (await call(`attempts?after=${page.nextCursor}`)).json();
  expect(next.attempts).toHaveLength(5); expect(next.hasMore).toBe(false);
  expect(new Set([...page.attempts, ...next.attempts].map(a => a.id)).size).toBe(105);
});
it("rejects malformed cursors and generation numbers", async () => {
  expect((await call("attempts?after=garbage")).status).toBe(400);
  const f = await fixture(); expect((await call(`events/${f.event.id}?generation=-1`)).status).toBe(400);
});
