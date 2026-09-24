import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({ session: vi.fn(), publish: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("../../lib/queue/client", () => ({ publish: mocks.publish }));
import { db } from "../../lib/db";
import { createApplication } from "../fixtures";
import { encryptEndpointSecret } from "../../lib/endpoint-secrets";
import { ingest } from "../../lib/events";
import { POST } from "../../app/api/endpoints/[id]/test/route";
let uid: string, ws: string, appId: string, endpointId: string, secondId: string;
const call = (id = endpointId, origin?: string, body: unknown = {}) => POST(new Request("http://localhost/api/test", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) } }), { params: Promise.resolve({ id }) });
beforeEach(async () => {
  vi.clearAllMocks();
  uid = randomUUID(); await db.user.create({ data: { id: uid, email: uid + "@example.com", hashedPassword: "unused" } });
  ws = (await db.workspace.create({ data: { name: "Tests", members: { create: { userId: uid, role: "OWNER" } } } })).id;
  appId = (await createApplication({ data: { workspaceId: ws, name: "Synthetic", currentApiKey: randomUUID() } })).id;
  for (const id of [endpointId = randomUUID(), secondId = randomUUID()]) {
    const ctx = { id, applicationId: appId, secretVersion: 1 };
    await db.endpoint.create({ data: { ...ctx, url: "https://example.com/hook", eventTypes: ["orders.created"], signatureFormat: "STANDARD", secret: encryptEndpointSecret("test-secret", ctx) } });
  }
  mocks.session.mockResolvedValue({ user: { id: uid } });
});
afterEach(async () => { await db.ipRateBucket.deleteMany({ where: { key: { in: [`endpoint-test:${endpointId}`, `endpoint-test:${secondId}`] } } }); await db.workspace.delete({ where: { id: ws } }); await db.user.delete({ where: { id: uid } }); vi.unstubAllEnvs(); });
afterAll(() => db.$disconnect());
it.each(["OWNER", "ADMIN", "MEMBER"] as const)("allows %s to test only the selected endpoint through the outbox", async role => {
  // Keep the unique OWNER invariant: a second member account exercises other roles.
  let memberId: string | undefined;
  if (role !== "OWNER") { memberId = randomUUID(); await db.user.create({ data: { id: memberId, email: memberId + "@example.com", hashedPassword: "unused" } }); await db.workspaceMember.create({ data: { userId: memberId, workspaceId: ws, role } }); mocks.session.mockResolvedValue({ user: { id: memberId } }); }
  try {
    const result = await call(); expect(result.status).toBe(202); const { eventId } = await result.json();
    const event = await db.event.findUniqueOrThrow({ where: { id: eventId } }); expect(event.type).toBe("hooka.test"); expect(event.payload).toMatchObject({ hookaTest: true });
    const deliveries = await db.delivery.findMany({ where: { eventId } }); expect(deliveries).toHaveLength(1); expect(deliveries[0].endpointId).toBe(endpointId); expect(deliveries[0].attemptNumber).toBe(1); expect(mocks.publish).toHaveBeenCalled();
  } finally { if (memberId) { await db.workspaceMember.deleteMany({ where: { userId: memberId } }); await db.user.delete({ where: { id: memberId } }); } }
});
it("rejects outsiders, forged endpoint configuration and cross-origin requests", async () => {
  expect((await call(endpointId, "https://attacker.example")).status).toBe(403);
  expect((await call(endpointId, undefined, { url: "https://attacker.example" })).status).toBe(400);
  mocks.session.mockResolvedValue({ user: { id: "outsider" } }); expect((await call()).status).toBe(404);
  expect(await db.event.count({ where: { applicationId: appId } })).toBe(0);
});
it("never resets pause or circuit protection and rolls back an unavailable target", async () => {
  await db.endpoint.update({ where: { id: endpointId }, data: { status: "PAUSED" } }); expect((await call()).status).toBe(409);
  await db.endpoint.update({ where: { id: endpointId }, data: { status: "ACTIVE", circuitState: "OPEN", consecutiveFailures: 5 } }); expect((await call()).status).toBe(409);
  await expect(ingest(appId, { type: "hooka.test", payload: {} }, { endpointId: "another-app-endpoint" })).rejects.toMatchObject({ status: 404 });
  expect(await db.event.count({ where: { applicationId: appId } })).toBe(0);
  expect((await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } })).consecutiveFailures).toBe(5);
});
it("enforces the shared five-tests/minute budget with Retry-After", async () => {
  const key = `endpoint-test:${endpointId}`;
  await db.$executeRaw`INSERT INTO "IpRateBucket" (key,bucket,hits,"expiresAt") VALUES (${key}, FLOOR(EXTRACT(EPOCH FROM NOW())/60)::bigint,5,NOW()+interval '2 minutes')`;
  const result = await call(); expect(result.status).toBe(429); expect(result.headers.get("retry-after")).toBe("60"); expect(mocks.publish).not.toHaveBeenCalled();
});
it("retains application admission limits and opt-in schema validation", async () => {
  await db.eventSchema.create({ data: { applicationId: appId, eventType: "hooka.test", schema: { type: "object", properties: { custom: { type: "string" } }, required: ["custom"] } } });
  const invalid = await call(); expect(invalid.status).toBe(400); expect((await invalid.json()).failures).toBeDefined();
  vi.stubEnv("EVENTS_RATE_LIMIT_PER_MINUTE", "1"); const limited = await call(); expect(limited.status).toBe(429); expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(await db.event.count({ where: { applicationId: appId } })).toBe(0);
});
