import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const session = vi.hoisted(() => vi.fn());
vi.mock("next-auth", () => ({ getServerSession: session }));
vi.mock("../../lib/queue/client", () => ({ publish: vi.fn().mockResolvedValue(undefined) }));
import { db } from "../../lib/db";
import { createApplication } from "../fixtures";
import { defaultWorkspace } from "../../lib/workspaces";
import { hashApiKey } from "../../lib/secrets";
import { encryptEndpointSecret } from "../../lib/endpoint-secrets";
import { applicationForKey } from "../../lib/api-keys";
import { cliApi } from "../../lib/cli-api";
import { eventBacklog } from "../../lib/event-backlog";
import { publishEventType } from "../../lib/event-catalog";
import { ingest } from "../../lib/events";
import { startRecovery, drainRecovery } from "../../lib/recovery";
import { operationalEvent, sendOperationalNotice } from "../../lib/operational-events";
import { POST as createKey, GET as keys } from "../../app/api/applications/[id]/keys/route";
import { PATCH as configure } from "../../app/api/endpoints/[id]/configuration/route";
let uid: string, workspaceId: string, app: { id: string; currentApiKey: string }, other: { id: string; currentApiKey: string };
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown, method = "POST") => new Request("http://localhost/api/test", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
beforeEach(async () => {
  uid = (await db.user.create({ data: { email: randomUUID() + "@example.com", hashedPassword: "unused" } })).id;
  workspaceId = await defaultWorkspace(uid); session.mockResolvedValue({ user: { id: uid } });
  app = await createApplication({ data: { workspaceId, name: "Lifecycle", currentApiKey: randomUUID() } });
  other = await createApplication({ data: { workspaceId, name: "Other", currentApiKey: randomUUID() } });
});
afterEach(async () => { await db.workspace.delete({ where: { id: workspaceId } }); await db.user.delete({ where: { id: uid } }); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => db.$disconnect());
async function endpoint(kind: "BUSINESS" | "OPERATIONAL" = "BUSINESS", applicationId = app.id) {
  const ctx = { id: randomUUID(), applicationId, secretVersion: 1 };
  return db.endpoint.create({ data: { ...ctx, kind, url: "https://example.com/hook", eventTypes: ["*"], signatureFormat: "STANDARD", secret: encryptEndpointSecret("secret", ctx) } });
}
it("enforces read/ingest scopes, expiry and legacy compatibility and records last use", async () => {
  for (const scope of ["READ_ONLY", "INGEST_ONLY"] as const) {
    const key = randomUUID(); const row = await db.applicationKey.create({ data: { applicationId: app.id, name: scope, scope, hash: hashApiKey(key) } });
    for (const permission of ["READ", "INGEST", "MANAGE"] as const) {
      if ((scope === "READ_ONLY" && permission === "READ") || (scope === "INGEST_ONLY" && permission === "INGEST")) expect((await applicationForKey(key, permission))?.id).toBe(app.id);
      else await expect(applicationForKey(key, permission)).rejects.toMatchObject({ status: 403 });
    }
    expect((await db.applicationKey.findUniqueOrThrow({ where: { id: row.id } })).lastUsedAt).not.toBeNull();
    await db.applicationKey.update({ where: { id: row.id }, data: { expiresAt: new Date(0) } });
    expect(await applicationForKey(key)).toBeNull();
  }
  for (const permission of ["READ", "INGEST", "MANAGE"] as const) expect((await applicationForKey(app.currentApiKey, permission))?.id).toBe(app.id);
});
it("shows scoped keys once and denies member configuration/key creation", async () => {
  const created = await createKey(req({ name: "reader", scope: "READ_ONLY" }), context(app.id));
  expect(created.status).toBe(201); const body = await created.json(); expect(body.key).toMatch(/^hr_scoped_/); expect(body.hash).toBeUndefined();
  expect((await (await keys(new Request("http://localhost"), context(app.id))).json())[0].key).toBeUndefined();
  expect((await db.applicationKey.findUniqueOrThrow({ where: { id: body.id } })).hash).toBe(hashApiKey(body.key));
  const ep = await endpoint();
  expect((await configure(req({ environment: "preview-42", deliveryRatePerMinute: 2, customHeaders: { Authorization: "test" } }, "PATCH"), context(ep.id))).status).toBe(200);
  const changed = await db.endpoint.findUniqueOrThrow({ where: { id: ep.id } }); expect(changed.environment).toBe("preview-42"); expect(changed.customHeadersEncrypted).not.toContain("test");
  // Fixture role downgrade exercises authorization, not the ownership service.
  await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId: uid } }, data: { role: "MEMBER" } });
  expect((await configure(req({ environment: "forbidden" }, "PATCH"), context(ep.id))).status).toBe(403);
  expect((await createKey(req({ name: "forbidden", scope: "INGEST_ONLY" }), context(app.id))).status).toBe(403);
});
it("paginates tied timestamps, scopes event-ID anchors and includes paused backlog", async () => {
  const ep = await endpoint(), foreign = await endpoint("BUSINESS", other.id);
  await db.endpoint.update({ where: { id: ep.id }, data: { status: "PAUSED" } });
  const a = await ingest(app.id, { type: "test", payload: 1 }), b = await ingest(app.id, { type: "test", payload: 2 }), c = await ingest(other.id, { type: "test", payload: 3 });
  const tied = new Date("2026-01-01T00:00:00Z"); await db.event.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { createdAt: tied } });
  expect(await db.delivery.count({ where: { eventId: { in: [a.id, b.id] } } })).toBe(0);
  const page = await eventBacklog(app.id, new URL(`http://localhost?endpoint_id=${ep.id}&limit=1`)); expect(page.events).toHaveLength(1); expect(page.hasMore).toBe(true);
  const next = await eventBacklog(app.id, new URL(`http://localhost?endpoint_id=${ep.id}&limit=1&cursor=${page.nextCursor}`)); expect(next.events).toHaveLength(1); expect(next.events[0].id).not.toBe(page.events[0].id); expect(next.hasMore).toBe(false);
  await expect(eventBacklog(app.id, new URL(`http://localhost?since=${c.id}`))).rejects.toMatchObject({ status: 400 });
  await expect(eventBacklog(app.id, new URL(`http://localhost?endpoint_id=${foreign.id}`))).rejects.toMatchObject({ status: 404 });
  const readKey = randomUUID(); await db.applicationKey.create({ data: { applicationId: app.id, name: "reader", scope: "READ_ONLY", hash: hashApiKey(readKey) } });
  expect((await cliApi(new Request(`http://localhost/api/v1/applications/${app.id}/events`, { headers: { authorization: `Bearer ${readKey}` } }), ["applications", app.id, "events"])).status).toBe(200);
  expect((await cliApi(new Request(`http://localhost/api/v1/applications/${other.id}/events`, { headers: { authorization: `Bearer ${readKey}` } }), ["applications", other.id, "events"])).status).toBe(404);
});
it("versions catalog schemas without changing duplicate-first or free-form ingestion", async () => {
  const first = await ingest(app.id, { type: "typed", payload: 1, idempotencyKey: "same" });
  await db.$transaction(tx => publishEventType(tx, app.id, { eventType: "typed", description: "An object", schema: { type: "object" } }));
  expect((await ingest(app.id, { type: "typed", payload: 2, idempotencyKey: "same" })).id).toBe(first.id);
  await expect(ingest(app.id, { type: "typed", payload: 2 })).rejects.toThrow();
  await expect(ingest(app.id, { type: "free.form", payload: 2 })).resolves.toHaveProperty("id");
  const version = await db.$transaction(tx => publishEventType(tx, app.id, { eventType: "typed", description: "No validation" })); expect(version.version).toBe(2);
  await expect(ingest(app.id, { type: "typed", payload: 2 })).resolves.toHaveProperty("id");
});
it("durably recovers only latest exhausted deliveries once and rejects duplicate jobs", async () => {
  const ep = await endpoint();
  const events = await Promise.all([1, 2, 3].map(n => db.event.create({ data: { applicationId: app.id, type: "test", payload: n, idempotencyKey: randomUUID(), createdAt: new Date(0) } })));
  for (const e of events) await db.delivery.create({ data: { endpointId: ep.id, eventId: e.id, status: "DEAD_LETTERED", createdAt: new Date(0) } });
  await db.delivery.create({ data: { endpointId: ep.id, eventId: events[1].id, status: "DELIVERED", generation: 1 } });
  await db.delivery.create({ data: { endpointId: ep.id, eventId: events[2].id, status: "PENDING", generation: 1 } });
  const job = await startRecovery(app.id, new Date(0), ep.id);
  await expect(startRecovery(app.id, new Date(0))).rejects.toMatchObject({ status: 409 });
  await Promise.all([drainRecovery(), drainRecovery()]); await drainRecovery();
  expect(await db.recoveryJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ queued: 1, status: "COMPLETE" });
  expect(await db.delivery.count({ where: { eventId: events[0].id } })).toBe(2);
  await expect(startRecovery(app.id, new Date(0))).rejects.toMatchObject({ status: 429 });
});
it("routes meta events only to operational subscriptions and prevents recursion", async () => {
  const business = await endpoint(), ops = await endpoint("OPERATIONAL");
  const input = await ingest(app.id, { type: "endpoint.disabled", payload: {} });
  expect(await db.delivery.count({ where: { eventId: input.id, endpointId: ops.id } })).toBe(0);
  await db.$transaction(tx => operationalEvent(tx, business, "endpoint.disabled", {}));
  const meta = await db.event.findFirstOrThrow({ where: { applicationId: app.id, operational: true } });
  expect(await db.delivery.count({ where: { eventId: meta.id, endpointId: ops.id } })).toBe(1);
  expect(await db.delivery.count({ where: { eventId: meta.id, endpointId: business.id } })).toBe(0);
  await db.$transaction(tx => operationalEvent(tx, ops, "message.failed", {}));
  expect(await db.event.count({ where: { applicationId: app.id, operational: true } })).toBe(1);
  vi.stubEnv("RESEND_API_KEY", "mock"); vi.stubEnv("RESEND_FROM", "test@example.com"); vi.stubEnv("NEXTAUTH_URL", "https://example.com");
  const send = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", send);
  await sendOperationalNotice({ id: meta.id, applicationId: app.id, endpointId: business.id, since: new Date(0) }, "owner@example.com");
  expect(JSON.parse(send.mock.calls[0][1].body).text).toContain(`/applications/${app.id}/backlog?endpoint_id=`);
});
