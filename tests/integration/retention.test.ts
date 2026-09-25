import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "../../lib/db";
import { pruneEventHistory } from "../../lib/retention";
import { createApplication } from "../fixtures";
import { defaultWorkspace } from "../../lib/workspaces";

afterAll(() => db.$disconnect());

it("purges old terminal history and raw receipts without touching unfinished work", async () => {
  const now = new Date("2026-09-24T12:00:00Z");
  const old = new Date("2026-08-01T00:00:00Z");
  const recent = new Date("2026-09-23T00:00:00Z");
  const activeLive = new Date("2026-09-24T11:30:00Z");
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.com` } });
  const workspaceId = await defaultWorkspace(user.id);
  try {
    const app = await createApplication({ data: { workspaceId, name: "Retention", currentApiKey: randomUUID() } });
    const heldApp = await createApplication({ data: { workspaceId, name: "Recovery", currentApiKey: randomUUID() } });
    const endpoint = await db.endpoint.create({ data: { applicationId: app.id, url: "https://example.com/hook", secret: "unused", eventTypes: ["*"] } });
    const source = await db.webhookSource.create({ data: { applicationId: app.id, name: "Test", provider: "STRIPE", ingestionToken: randomBytes(32).toString("hex") } });
    const makeEvent = (applicationId: string, createdAt: Date) => db.event.create({ data: { applicationId, webhookSourceId: applicationId === app.id ? source.id : undefined, type: "test", payload: { private: "payload" }, idempotencyKey: randomUUID(), createdAt } });
    const terminal = await makeEvent(app.id, old);
    const pending = await makeEvent(app.id, old);
    const routed = await makeEvent(app.id, old);
    const current = await makeEvent(app.id, recent);
    const held = await makeEvent(heldApp.id, old);
    const terminalDelivery = await db.delivery.create({ data: { eventId: terminal.id, endpointId: endpoint.id, status: "DELIVERED" } });
    const pendingDelivery = await db.delivery.create({ data: { eventId: pending.id, endpointId: endpoint.id, status: "PENDING" } });
    await db.deliveryAttempt.create({ data: { eventId: terminal.id, endpointId: endpoint.id, deliveryId: terminalDelivery.id, attemptNumber: 1, status: "SUCCESS", requestBody: "private body" } });
    await db.routingExecution.create({ data: { eventId: routed.id, webhookSourceId: source.id, status: "RUNNING" } });
    const receipt = await db.inboundReceipt.create({ data: { sourceId: source.id, eventId: terminal.id, provider: "STRIPE", rawBody: "private body", rawHeaders: {}, verified: true, receivedAt: old } });
    await db.inboundReplay.create({ data: { receiptId: receipt.id, userId: user.id } });
    const rejected = await db.inboundReceipt.create({ data: { sourceId: source.id, provider: "STRIPE", rawBody: "rejected body", rawHeaders: {}, verified: false, receivedAt: old } });
    const live = await db.inboundReceipt.create({ data: { sourceId: source.id, provider: "STRIPE", rawBody: "in flight", rawHeaders: {}, verified: false, receivedAt: old } });
    const liveAttempt = await db.inboundLiveAttempt.create({ data: { receiptId: live.id, sessionId: "test-session", status: "SENT", createdAt: activeLive } });
    const recovery = await db.recoveryJob.create({ data: { applicationId: heldApp.id, since: old, status: "PENDING" } });

    const first = await pruneEventHistory(now);
    expect(first.events).toBe(1);
    expect(first.receipts).toBeGreaterThanOrEqual(1);
    expect(await db.event.findUnique({ where: { id: terminal.id } })).toBeNull();
    expect(await db.deliveryAttempt.count({ where: { eventId: terminal.id } })).toBe(0);
    expect(await db.inboundReceipt.findUnique({ where: { id: receipt.id } })).toBeNull();
    expect(await db.inboundReplay.count({ where: { receiptId: receipt.id } })).toBe(0);
    expect(await db.inboundReceipt.findUnique({ where: { id: rejected.id } })).toBeNull();
    for (const id of [pending.id, routed.id, current.id, held.id])
      expect(await db.event.findUnique({ where: { id } })).not.toBeNull();
    expect(await db.inboundReceipt.findUnique({ where: { id: live.id } })).not.toBeNull();

    await db.delivery.update({ where: { id: pendingDelivery.id }, data: { status: "DELIVERED" } });
    await db.routingExecution.update({ where: { eventId_generation: { eventId: routed.id, generation: 0 } }, data: { status: "SUCCESS" } });
    await db.recoveryJob.update({ where: { id: recovery.id }, data: { status: "COMPLETE" } });
    await db.inboundLiveAttempt.update({ where: { id: liveAttempt.id }, data: { status: "DELIVERED" } });
    const second = await pruneEventHistory(now);
    expect(second).toMatchObject({ events: 3, receipts: 1 });
    expect(await db.event.findUnique({ where: { id: current.id } })).not.toBeNull();
    expect(await db.inboundReceipt.findUnique({ where: { id: live.id } })).toBeNull();
  } finally {
    await db.workspace.delete({ where: { id: workspaceId } });
    await db.user.delete({ where: { id: user.id } });
  }
});
