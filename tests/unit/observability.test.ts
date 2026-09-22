import { afterAll, expect, it } from "vitest";
import { trace, context, metrics, ROOT_CONTEXT, SpanStatusCode } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { InMemoryMetricExporter, PeriodicExportingMetricReader, MeterProvider, AggregationTemporality } from "@opentelemetry/sdk-metrics";
import { PrivateSpanProcessor } from "../../lib/observability-runtime";
import { traced, traceparent, storedContext, deliveryMetric, count, queueDepth } from "../../lib/observability";
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new PrivateSpanProcessor(new SimpleSpanProcessor(exporter))] });
provider.register();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const meters = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60000 })] });
metrics.setGlobalMeterProvider(meters);
afterAll(async () => { await provider.shutdown(); await meters.shutdown(); trace.disable(); context.disable(); metrics.disable(); });
it("retains the trace across durable storage, outbox recovery and retries", async () => {
  let saved: string | undefined;
  await traced("event.ingest", {}, async () => { saved = traceparent(); });
  await context.with(ROOT_CONTEXT, () => traced("outbox.enqueue", {}, async () => {}, saved));
  await context.with(ROOT_CONTEXT, () => traced("delivery.attempt", { "hooka.attempt": 2 }, async () => {}, saved));
  const spans = exporter.getFinishedSpans().slice(-3);
  expect(new Set(spans.map(s => s.spanContext().traceId)).size).toBe(1);
  expect(spans[1].parentSpanContext?.spanId).toBe(spans[0].spanContext().spanId);
  expect(spans[2].parentSpanContext?.spanId).toBe(spans[0].spanContext().spanId);
});
it.each([undefined, "bogus", "00-" + "0".repeat(32) + "-" + "1".repeat(16) + "-01", "00-" + "1".repeat(32) + "-" + "0".repeat(16) + "-01"])("rejects invalid persisted context %s", value => {
  expect(trace.getSpanContext(storedContext(value))).toBeUndefined();
});
it("strips URLs, headers, exception messages, events and baggage links before export", async () => {
  await expect(traced("delivery.attempt", { "hooka.endpoint.id": "ep", "url.full": "https://receiver/?secret", authorization: "secret" }, async span => {
    span.recordException(new Error("password")); span.addEvent("payload", { body: "secret" }); throw new Error("private error");
  })).rejects.toThrow("private error");
  const span = exporter.getFinishedSpans().at(-1)!;
  expect(span.attributes).toEqual({ "hooka.endpoint.id": "ep" });
  expect(span.events).toEqual([]); expect(span.links).toEqual([]); expect(span.status).toEqual({ code: SpanStatusCode.ERROR });
  expect(JSON.stringify(span)).not.toMatch(/password|private error|receiver|authorization/);
});
it("exports a generic Next request without exposing capability URLs and drops framework child spans", () => {
  const before = exporter.getFinishedSpans().length;
  trace.getTracer("next.js").startSpan("GET /portal/secret", { attributes: { "next.span_type": "BaseServer.handleRequest", "next.route": "/portal/secret" } }).end();
  trace.getTracer("next.js").startSpan("SQL private", { attributes: { "next.span_type": "fetch" } }).end();
  expect(exporter.getFinishedSpans().length).toBe(before + 1);
  expect(exporter.getFinishedSpans().at(-1)?.name).toBe("next.request");
  expect(exporter.getFinishedSpans().at(-1)?.attributes).toEqual({});
});
it("records unsampled latency, outcome, queue and retry metrics without tenant data", async () => {
  deliveryMetric(1500, "success"); deliveryMetric(10000, "failure"); count("hooka.delivery.retries", { delay: "retry-delay-30s" }); queueDepth(4);
  await meters.forceFlush();
  const data = metricExporter.getMetrics().flatMap(m => m.scopeMetrics.flatMap(s => s.metrics));
  expect(data.find(m => m.descriptor.name === "hooka.delivery.duration")?.dataPoints[0].value).toMatchObject({ count: 1, sum: 1.5 });
  expect(data.find(m => m.descriptor.name === "hooka.queue.depth")?.dataPoints[0].value).toBe(4);
  expect(data.find(m => m.descriptor.name === "hooka.delivery.retries")?.dataPoints[0].attributes).toEqual({ delay: "retry-delay-30s" });
});
