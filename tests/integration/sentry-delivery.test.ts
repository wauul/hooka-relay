import { afterAll, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/node";
import { randomUUID } from "node:crypto";
vi.mock("../../lib/queue/client", () => ({ publish: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/deliver", () => ({ deliver: vi.fn().mockResolvedValue({ code: 200, body: "ok", headers: {}, error: null, duration: 1 }) }));
import { db } from "../../lib/db";
import { createApplication } from "../fixtures";
import { encryptEndpointSecret } from "../../lib/endpoint-secrets";
import { ingest } from "../../lib/events";
import { processJob } from "../../worker/process-job";
import { deliver } from "../../lib/deliver";
import { reportUnexpected } from "../../lib/sentry-reporting";
import { sentryOptions } from "../../lib/sentry-options";
afterAll(async () => { await Sentry.close(100); await db.$disconnect(); });
it("accepts and delivers exactly once with a failed Sentry transport, preserving leases and duplicate wakeups", async () => {
  let sends = 0;
  Sentry.init({ ...sentryOptions("worker"), enabled: true, dsn: "https://public@o1.ingest.sentry.io/1", defaultIntegrations: false, integrations: [], skipOpenTelemetrySetup: true, transport: () => ({ send: async () => { sends++; throw new Error("telemetry offline"); }, flush: async () => false }) });
  const uid = randomUUID();
  await db.user.create({ data: { id: uid, email: `${uid}@example.com` } });
  const ws = await db.workspace.create({ data: { name: "Disposable telemetry fixture", members: { create: { userId: uid, role: "OWNER" } } } });
  try {
    const app = await createApplication({ data: { workspaceId: ws.id, name: "Telemetry fixture", currentApiKey: randomUUID() } });
    const endpoint = await db.endpoint.create({ data: { applicationId: app.id, url: "https://example.com/hook", secret: "pending", eventTypes: ["*"] } });
    await db.endpoint.update({ where: { id: endpoint.id }, data: { secret: encryptEndpointSecret("fixture-secret", endpoint) } });
    reportUnexpected(new TypeError("controlled internal defect"), "worker.consume");
    const event = await ingest(app.id, { type: "telemetry.test", payload: { private: "never telemetry" }, idempotencyKey: "one" });
    const delivery = await db.delivery.findFirstOrThrow({ where: { eventId: event.id } });
    await processJob({ id: delivery.id, attemptNumber: delivery.attemptNumber });
    await processJob({ id: delivery.id, attemptNumber: delivery.attemptNumber });
    expect((await ingest(app.id, { type: "telemetry.test", payload: {}, idempotencyKey: "one" })).id).toBe(event.id);
    expect(await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "DELIVERED" });
    expect(await db.endpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).toMatchObject({ leaseToken: null, leaseUntil: null });
    expect(await db.deliveryAttempt.count({ where: { deliveryId: delivery.id } })).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    await Sentry.flush(100).catch(() => false);
    expect(sends).toBeGreaterThan(0);
  } finally { await db.workspace.delete({ where: { id: ws.id } }); await db.user.delete({ where: { id: uid } }); }
});
