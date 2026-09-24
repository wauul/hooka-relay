import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import WebSocket from "ws";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApplication } from "../fixtures";
import { defaultWorkspace } from "../../lib/workspaces";
const broker = vi.hoisted(() => ({ publish: vi.fn(), live: vi.fn() }));
vi.mock("../../lib/queue/client", () => ({ publish: broker.publish, publishInboundLive: broker.live }));
import { db } from "../../lib/db";
import { encryptSecret } from "../../lib/secrets";
import { POST } from "../../app/api/inbound/[ingestionToken]/route";
import { authorizeLiveSource } from "../../lib/live-auth";
import { createLiveRelay } from "../../worker/live-relay";

let userId: string, appId: string, sourceId: string, endpointId: string, token: string, apiKey: string;
const secret = "github-source-secret";
const payload = JSON.stringify({ action: "opened", issue: { id: 42 } });
function incoming(body = payload, signature?: string) {
  return new Request(`https://hooka.example/api/inbound/${token}`, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) }, body });
}
const sign = (body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
beforeEach(async () => {
  vi.clearAllMocks(); broker.publish.mockResolvedValue(undefined); broker.live.mockResolvedValue(undefined);
  process.env.ENDPOINT_SECRET_ENCRYPTION_KEY = "11".repeat(32);
  userId = (await db.user.create({ data: { email: `${randomUUID()}@example.com`, hashedPassword: "test" } })).id;
  const app = await createApplication({ data: { workspaceId: await defaultWorkspace(userId), name: "Inbound fixture", currentApiKey: randomUUID() } });
  appId = app.id;
  apiKey = app.currentApiKey;
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
  expect(await db.inboundReceipt.count({ where: { sourceId, verified: false } })).toBe(2);
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
  const receipt = await db.inboundReceipt.findUniqueOrThrow({ where: { eventId } });
  expect(Buffer.from(receipt.rawBody, "base64").toString("utf8")).toBe(payload);
  expect(broker.live).toHaveBeenCalledWith(sourceId, receipt.id);
  expect(broker.publish).toHaveBeenCalledWith({ id: delivery.id, attemptNumber: 1 }, null);
  expect((await POST(incoming(payload, sign(payload)), context)).status).toBe(202);
  expect(await db.delivery.count({ where: { eventId } })).toBe(1);
  expect(await db.event.count({ where: { webhookSourceId: sourceId } })).toBe(1);
  expect((await db.webhookSource.findUniqueOrThrow({ where: { id: sourceId } })).lastVerifiedAt).toBeInstanceOf(Date);
});
it("accepts a verified event for a local listener without a destination", async () => {
  await db.webhookSource.update({ where: { id: sourceId }, data: { endpointId: null, destinationUrl: null } });
  const response = await POST(incoming(payload, sign(payload)), { params: Promise.resolve({ ingestionToken: token }) });
  expect(response.status).toBe(202);
  const eventId = (await response.json()).id;
  expect(await db.delivery.count({ where: { eventId } })).toBe(0);
  expect((await db.inboundReceipt.findUniqueOrThrow({ where: { eventId } })).verified).toBe(true);
  expect(broker.live).toHaveBeenCalledOnce();
});
it("authenticates a source within the key's application and rejects another application's source", async () => {
  expect((await authorizeLiveSource(apiKey, sourceId)).sourceId).toBe(sourceId);
  const other = await createApplication({ data: { workspaceId: await defaultWorkspace(userId), name: "Other", currentApiKey: randomUUID() } });
  const otherSource = await db.webhookSource.create({ data: { applicationId: other.id, name: "Other source", provider: "GITHUB", ingestionToken: randomBytes(32).toString("hex") } });
  await expect(authorizeLiveSource(apiKey, otherSource.id)).rejects.toThrow("Source not found");
  await db.webhookSource.delete({ where: { id: otherSource.id } });
  await db.application.delete({ where: { id: other.id } });
});
it("sends the exact captured headers and body through a subscribed live socket", async () => {
  const server = createServer();
  const relay = createLiveRelay(server);
  let consumer: ((message: ConsumeMessage | null) => void) | undefined;
  const channel = {
    assertQueue: vi.fn(async () => ({ queue: "live-test" })),
    bindQueue: vi.fn(async () => {}), unbindQueue: vi.fn(async () => {}),
    consume: vi.fn(async (_queue, callback) => { consumer = callback; }), ack: vi.fn(),
  } as unknown as ConfirmChannel;
  await relay.attach(channel);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/live`);
  try {
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const subscribed = new Promise<{ type: string; sourceId: string }>(resolve => socket.once("message", data => resolve(JSON.parse(data.toString()))));
    socket.send(JSON.stringify({ type: "subscribe", apiKey, source: sourceId }));
    expect((await subscribed).sourceId).toBe(sourceId);
    const body = JSON.stringify({ action: "opened", issue: { id: 43 } });
    const response = await POST(incoming(body, sign(body)), { params: Promise.resolve({ ingestionToken: token }) });
    const receipt = await db.inboundReceipt.findUniqueOrThrow({ where: { eventId: (await response.json()).id } });
    const event = new Promise<{ bodyBase64: string; headers: Record<string, string>; attemptId: string }>(resolve => socket.once("message", data => resolve(JSON.parse(data.toString()))));
    consumer?.({ content: Buffer.from(JSON.stringify({ receiptId: receipt.id })) } as ConsumeMessage);
    const received = await event;
    expect(Buffer.from(received.bodyBase64, "base64").toString()).toBe(body);
    expect(received.headers["x-hub-signature-256"]).toBe(sign(body));
    socket.send(JSON.stringify({ type: "ack", attemptId: received.attemptId, status: 204, durationMs: 12 }));
    await vi.waitFor(async () => expect((await db.inboundLiveAttempt.findUniqueOrThrow({ where: { id: received.attemptId } })).status).toBe("SUCCESS"));
  } finally {
    socket.close(); relay.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
