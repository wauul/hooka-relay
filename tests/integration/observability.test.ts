import { afterAll, expect, it, vi } from "vitest";
import { context, trace, ROOT_CONTEXT } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
vi.mock("../../lib/queue/client", () => ({ publish: vi.fn().mockResolvedValue(undefined) }));
import { db } from "../../lib/db";
import { createApplication } from "../fixtures";
import { ingest } from "../../lib/events";
import { randomUUID } from "node:crypto";
// Exercise actual event storage, including duplicate admission under a later trace.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
afterAll(async () => { context.disable(); await db.$disconnect(); });
it("persists initial ingestion context and never overwrites it for an idempotent retry", async () => {
  const uid = randomUUID();
  await db.user.create({ data: { id: uid, email: uid + "@example.com", hashedPassword: "unused" } });
  const ws = await db.workspace.create({ data: { name: "Trace migration fixture", members: { create: { userId: uid, role: "OWNER" } } } });
  try {
    const app = await createApplication({ data: { workspaceId: ws.id, name: "Trace", currentApiKey: randomUUID() } });
    const parent = trace.setSpanContext(ROOT_CONTEXT, { traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1 });
    const input = { type: "trace.test", payload: { ordinary: true }, idempotencyKey: randomUUID() };
    const first = await context.with(parent, () => ingest(app.id, input));
    expect(first.traceparent).toBe("00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01");
    const duplicate = await context.with(ROOT_CONTEXT, () => ingest(app.id, input));
    expect(duplicate.id).toBe(first.id); expect(duplicate.traceparent).toBe(first.traceparent);
    const old = await db.event.create({ data: { applicationId: app.id, type: "legacy.test", payload: {}, idempotencyKey: randomUUID() } });
    expect(old.traceparent).toBeNull(); expect(old.applicationId).toBe(app.id);
  } finally { await db.workspace.delete({ where: { id: ws.id } }); await db.user.delete({ where: { id: uid } }); }
});
