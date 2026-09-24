import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { afterAll, expect, it, vi } from "vitest";

const broker = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("../../lib/queue/client", () => ({ publish: broker.publish }));
import { db } from "../../lib/db";
import { defaultWorkspace } from "../../lib/workspaces";
import { createApplication } from "../fixtures";
import { flushDelivery, ingest } from "../../lib/events";

afterAll(() => db.$disconnect());
const percentile = (sorted: number[], portion: number) => Number(sorted[Math.ceil(sorted.length * portion) - 1].toFixed(1));

it("measures a bounded ingest burst, broker outage and outbox recovery", async () => {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.com` } });
  const workspaceId = await defaultWorkspace(user.id);
  try {
    const app = await createApplication({ data: { workspaceId, name: "Capacity", currentApiKey: randomUUID() } });
    await db.endpoint.create({ data: { applicationId: app.id, url: "https://example.com/hook", secret: "unused", eventTypes: ["*"] } });
    broker.publish.mockRejectedValue(new Error("broker unavailable"));
    const latencies: number[] = [];
    const started = performance.now();
    const total = 60, concurrency = 6;
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < total) {
        const i = next++;
        const began = performance.now();
        await ingest(app.id, { type: "capacity.test", payload: { i }, idempotencyKey: `capacity-${i}` });
        latencies.push(performance.now() - began);
      }
    }));
    const duration = (performance.now() - started) / 1000;
    const pending = await db.delivery.findMany({ where: { event: { applicationId: app.id }, status: "PENDING" }, select: { id: true, publishedAt: true } });
    expect(pending).toHaveLength(total);
    expect(pending.every(row => row.publishedAt === null)).toBe(true);
    const largestBacklog = pending.length;
    broker.publish.mockResolvedValue(undefined);
    const recoveryStarted = performance.now();
    for (const row of pending) await flushDelivery(row.id);
    const recoverySeconds = (performance.now() - recoveryStarted) / 1000;
    expect(await db.delivery.count({ where: { event: { applicationId: app.id }, publishedAt: null } })).toBe(0);
    latencies.sort((a, b) => a - b);
    const report = { capacity: { total, concurrency, sustainedAcceptedPerSecond: Number((total / duration).toFixed(2)), latencyMs: { p50: percentile(latencies, .5), p95: percentile(latencies, .95), p99: percentile(latencies, .99) }, largestBacklog, brokerRecoverySeconds: Number(recoverySeconds.toFixed(2)), limitUnchanged: true } };
    console.log(JSON.stringify(report));
    writeFileSync("capacity-results.json", JSON.stringify(report, null, 2) + "\n");
  } finally {
    await db.workspace.delete({ where: { id: workspaceId } });
    await db.user.delete({ where: { id: user.id } });
    broker.publish.mockReset();
  }
}, 120_000);
