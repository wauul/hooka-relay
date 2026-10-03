import { afterAll, expect, it } from "vitest";
import * as Sentry from "@sentry/node";
import { context, trace, metrics } from "@opentelemetry/api";
import { startObservability, stopObservability } from "../../lib/observability-runtime";
import { flushObservability } from "../../lib/observability-runtime";
import { isolatedOperation, reportUnexpected } from "../../lib/sentry-reporting";
import { sentryOptions } from "../../lib/sentry-options";
import { traced } from "../../lib/observability";
import type { Envelope, TransactionEvent } from "@sentry/core";
const envelopes: Envelope[] = [];
Sentry.init({ ...sentryOptions("worker"), enabled: true, dsn: "https://public@o1.ingest.sentry.io/1", tracesSampleRate: 1, defaultIntegrations: false, integrations: [], skipOpenTelemetrySetup: true, transport: () => ({ send: async envelope => { envelopes.push(envelope); return {}; }, flush: async () => true }) });
process.env.SENTRY_TRACES_SAMPLE_RATE = "1";
startObservability("worker", Sentry.getClient());
afterAll(async () => { await stopObservability(); await Sentry.close(); trace.disable(); context.disable(); metrics.disable(); delete (globalThis as { hookaObservability?: unknown }).hookaObservability; delete process.env.SENTRY_TRACES_SAMPLE_RATE; });
const events = () => envelopes.flatMap(e => e[1].filter(i => i[0].type === "event").map(i => i[1] as Sentry.ErrorEvent));
it("isolates concurrent jobs and associates errors with active persisted traces", async () => {
  const ids = ["c" + "a".repeat(24), "c" + "b".repeat(24)];
  await Promise.all(ids.map((id, index) => isolatedOperation("delivery.attempt", { service: "worker", delivery_id: id, attempt: index + 1 }, () => traced("delivery.attempt", {}, async () => {
    await new Promise(resolve => setTimeout(resolve, index === 0 ? 15 : 1));
    reportUnexpected(new TypeError("payload secret"), "delivery.attempt");
  }))));
  await Sentry.flush(2000);
  const rows = events().slice(-2);
  expect(rows).toHaveLength(2);
  expect(rows.map(e => e.tags?.delivery_id).sort()).toEqual([...ids].sort());
  for (const row of rows) { expect(row.tags?.attempt).toBe(String(ids.indexOf(String(row.tags?.delivery_id)) + 1)); expect(row.contexts?.trace?.trace_id).toMatch(/^[a-f0-9]{32}$/); }
  expect(new Set(rows.map(e => e.contexts?.trace?.trace_id)).size).toBe(2);
  expect(JSON.stringify(rows)).not.toContain("payload secret");
  await flushObservability();
  const transactions = envelopes.flatMap(e => e[1].filter(i => i[0].type === "transaction").map(i => i[1] as TransactionEvent));
  expect(transactions.filter(e => e.transaction === "delivery.attempt").length).toBeGreaterThanOrEqual(2);
  for (const row of rows) expect(transactions.some(tx => tx.contexts?.trace?.trace_id === row.contexts?.trace?.trace_id)).toBe(true);
});
it("deduplicates errors crossing boundaries and bounds recurring infrastructure failures", async () => {
  const before = events().length;
  const error = new Error("private broker credential");
  reportUnexpected(error, "broker.connect", {}, true); reportUnexpected(error, "worker.consume");
  reportUnexpected(new Error("same outage"), "broker.connect", {}, true);
  reportUnexpected(new Error("UNAUTHORIZED"), "api.request");
  await Sentry.flush(2000); expect(events().length).toBe(before + 1);
});
it("keeps successful jobs independent of a failed telemetry transport", async () => {
  const client = Sentry.getClient()!;
  const transport = client.getTransport()!;
  const send = transport.send;
  transport.send = async () => { throw new Error("telemetry offline"); };
  try {
    const result = await isolatedOperation("delivery.attempt", { service: "worker" }, async () => { reportUnexpected(new Error("product defect"), "delivery.attempt"); return "acknowledge"; });
    expect(result).toBe("acknowledge"); await Sentry.flush(2000).catch(() => false);
  } finally { transport.send = send; }
});
