import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApplication } from "../fixtures";
import { defaultWorkspace } from "../../lib/workspaces";
const broker = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("../../lib/queue/client", () => ({ publish: broker.publish }));
import { db } from "../../lib/db";
import { encryptSecret } from "../../lib/secrets";
import { POST } from "../../app/api/inbound/[ingestionToken]/route";

let userId: string, appId: string, sourceId: string, endpointId: string, token: string;
const secret = "github-source-secret";
const payload = JSON.stringify({ action: "opened", issue: { id: 42 } });
function incoming(body = payload, signature?: string) {
  return new Request(`https://hooka.example/api/inbound/${token}`, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) }, body });
}
const sign = (body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
beforeEach(async () => {
  vi.clearAllMocks(); broker.publish.mockResolvedValue(undefined);
  process.env.ENDPOINT_SECRET_ENCRYPTION_KEY = "11".repeat(32);
  userId = (await db.user.create({ data: { email: `${randomUUID()}@example.com`, hashedPassword: "test" } })).id;
  const app = await createApplication({ data: { workspaceId: await defaultWorkspace(userId), name: "Inbound fixture", currentApiKey: randomUUID() } });
  appId = app.id;
  const endpoint = await db.endpoint.create({ data: { applicationId: appId, url: "https://example.com/receiver", secret: "unused-in-this-test", eventTypes: ["*"], kind: "INBOUND", circuitState: "OPEN", circuitOpenedAt: new Date() } });
  endpointId = endpoint.id;
  token = randomBytes(32).toString("hex");
  sourceId = (await db.webhookSource.create({ data: { applicationId: appId, endpointId, name: "GitHub fixture", provider: "GITHUB", ingestionToken: token, encryptedProviderSecret: encryptSecret(secret, appId), destinationUrl: endpoint.url, status: "ACTIVE" } })).id;
});
afterEach(async () => {
  await db.deliveryAttempt.deleteMany({ where: { event: { applicationId: appId } } });
  await db.delivery.deleteMany({ where: { event: { applicationId: appId } } });
  await db.event.deleteMany({ where: { applicationId: appId } });
  await db.webhookSource.deleteMany({ where: { applicationId: appId } });
  await db.endpoint.deleteMany({ where: { applicationId: appId } });
  await db.application.delete({ where: { id: appId } });
  await db.workspace.deleteMany({ where: { members: { some: { userId } } } });
  await db.user.delete({ where: { id: userId } });
});
afterAll(async () => db.$disconnect());
it("rejects missing and invalid provider signatures without enqueueing", async () => {
  expect((await POST(incoming(), { params: Promise.resolve({ ingestionToken: token }) })).status).toBe(401);
  expect((await POST(incoming(payload, sign("other")), { params: Promise.resolve({ ingestionToken: token }) })).status).toBe(401);
  expect(await db.event.count({ where: { webhookSourceId: sourceId } })).toBe(0);
  expect(broker.publish).not.toHaveBeenCalled();
  expect((await db.webhookSource.findUniqueOrThrow({ where: { id: sourceId } })).lastVerificationFailure).toBeTruthy();
});
it("routes a verified provider event into the existing outbox once, even with an open circuit", async () => {
  const context = { params: Promise.resolve({ ingestionToken: token }) };
  const first = await POST(incoming(payload, sign(payload)), context);
  expect(first.status).toBe(202);
  const eventId = (await first.json()).id;
  const delivery = await db.delivery.findFirstOrThrow({ where: { eventId } });
  expect(delivery.endpointId).toBe(endpointId);
  expect(delivery.status).toBe("PENDING");
  expect((await db.event.findUniqueOrThrow({ where: { id: eventId } })).webhookSourceId).toBe(sourceId);
  expect(broker.publish).toHaveBeenCalledWith({ id: delivery.id, attemptNumber: 1 }, null);
  expect((await POST(incoming(payload, sign(payload)), context)).status).toBe(202);
  expect(await db.delivery.count({ where: { eventId } })).toBe(1);
  expect(await db.event.count({ where: { webhookSourceId: sourceId } })).toBe(1);
  expect((await db.webhookSource.findUniqueOrThrow({ where: { id: sourceId } })).lastVerifiedAt).toBeInstanceOf(Date);
});
