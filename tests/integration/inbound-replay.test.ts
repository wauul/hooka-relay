import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApplication } from "../fixtures";
import { defaultWorkspace } from "../../lib/workspaces";

let userId: string, appId: string, sourceId: string, endpointId: string, receiptId: string, eventId: string;
const broker = vi.hoisted(() => ({ publish: vi.fn(), live: vi.fn() }));
vi.mock("../../lib/queue/client", () => ({ publish: broker.publish, publishInboundLive: broker.live }));
vi.mock("../../lib/access", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/access")>(),
  sameOrigin: vi.fn(), userId: vi.fn(async () => userId),
  ownApplication: vi.fn(async (id: string) => { if (id !== appId) throw new Error("NOT_FOUND"); return { id, role: "OWNER" }; }),
}));
import { db } from "../../lib/db";
import { originalReplayPayload } from "../../lib/inbound-replay-payload";
import { POST } from "../../app/api/sources/[id]/receipts/[receiptId]/replay/route";

const body = Buffer.from('{ "amount": 200, "name": "é" }\n', "utf8");
beforeEach(async () => {
  vi.clearAllMocks(); broker.publish.mockResolvedValue(undefined); broker.live.mockResolvedValue(undefined);
  userId = (await db.user.create({ data: { email: `${randomUUID()}@example.com`, hashedPassword: "test" } })).id;
  const app = await createApplication({ data: { workspaceId: await defaultWorkspace(userId), name: "Replay fixture", currentApiKey: randomUUID() } });
  appId = app.id;
  const endpoint = await db.endpoint.create({ data: { applicationId: appId, url: "https://example.com/hook", secret: "unused", eventTypes: ["*"], kind: "INBOUND" } });
  endpointId = endpoint.id;
  const source = await db.webhookSource.create({ data: { applicationId: appId, endpointId, destinationUrl: endpoint.url, name: "Stripe fixture", provider: "STRIPE", ingestionToken: randomBytes(32).toString("hex"), status: "ACTIVE" } });
  sourceId = source.id;
  const event = await db.event.create({ data: { applicationId: appId, webhookSourceId: sourceId, type: "payment.created", idempotencyKey: randomUUID(), payload: { data: { amount: 200 } } } });
  eventId = event.id;
  receiptId = (await db.inboundReceipt.create({ data: { sourceId, eventId, provider: "STRIPE", eventType: "payment.created", rawBody: body.toString("base64"), searchText: body.toString("utf8"), rawHeaders: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" }, verified: true } })).id;
});
afterEach(async () => {
  await db.deliveryAttempt.deleteMany({ where: { event: { applicationId: appId } } });
  await db.delivery.deleteMany({ where: { event: { applicationId: appId } } });
  await db.inboundReceipt.deleteMany({ where: { sourceId } });
  await db.event.deleteMany({ where: { applicationId: appId } });
  await db.webhookSource.deleteMany({ where: { applicationId: appId } });
  await db.endpoint.deleteMany({ where: { applicationId: appId } });
  await db.application.delete({ where: { id: appId } });
  await db.workspace.deleteMany({ where: { members: { some: { userId } } } });
  await db.user.delete({ where: { id: userId } });
});
afterAll(async () => db.$disconnect());

it("creates a replay generation using the saved original bytes and publishes the live receipt", async () => {
  const response = await POST(new Request("https://hooka.example/replay", { method: "POST" }), { params: Promise.resolve({ id: sourceId, receiptId }) });
  expect(response.status).toBe(202);
  expect((await response.json()).generation).toBe(0);
  expect(await db.delivery.count({ where: { eventId, endpointId, generation: 0 } })).toBe(1);
  const replay = await db.inboundReplay.findFirstOrThrow({ where: { receiptId } });
  expect(replay.userId).toBe(userId);
  expect(broker.live).toHaveBeenCalledWith(sourceId, receiptId, replay.id);
  const receipt = await db.inboundReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  const exact = originalReplayPayload(receipt);
  expect(exact.body).toEqual(body);
  expect(exact.headers["stripe-signature"]).toBe("t=1,v1=abc");
});
