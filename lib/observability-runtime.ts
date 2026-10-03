import { metrics, ROOT_CONTEXT, type Context } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor, TraceIdRatioBasedSampler, type Span, type ReadableSpan, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { SentryContextManager } from "@sentry/node";
import { SentrySpanProcessor, SentryPropagator, SentrySampler, wrapSamplingDecision } from "@sentry/opentelemetry";
import { flush, type Client } from "@sentry/core";
import { sampleRatio } from "./sentry-options";

// Defense in depth: framework instrumentation must never export route parameters,
// capability URLs, query strings, headers, SQL, exceptions or response bodies.
const allowed = new Set(["hooka.event.id", "hooka.delivery.id", "hooka.endpoint.id", "hooka.attempt", "hooka.generation", "hooka.outcome", "hooka.circuit", "hooka.delay_ms", "http.response.status_code", "http.request.method"]);
export function safeSpan(span: ReadableSpan): ReadableSpan {
  const custom = span.instrumentationScope.name === "hooka-relay";
  return {
    spanContext: () => span.spanContext(), parentSpanContext: span.parentSpanContext,
    kind: span.kind, startTime: span.startTime, endTime: span.endTime, duration: span.duration,
    ended: span.ended, resource: span.resource, instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount, droppedEventsCount: span.droppedEventsCount, droppedLinksCount: span.droppedLinksCount,
    name: custom ? span.name : "next.request",
    attributes: Object.fromEntries(Object.entries(span.attributes).filter(([key]) => allowed.has(key))),
    events: [], links: [], status: { code: span.status.code },
  };
}
export class PrivateSpanProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor, private readonly ratio?: number) {}
  onStart(span: Span, parent: Context) { this.delegate.onStart(span, parent); }
  onEnd(span: ReadableSpan) {
    if (span.instrumentationScope.name !== "hooka-relay" && span.attributes["next.span_type"] !== "BaseServer.handleRequest") return;
    if (this.ratio !== undefined && new TraceIdRatioBasedSampler(this.ratio).shouldSample(ROOT_CONTEXT, span.spanContext().traceId).decision !== 2) return;
    this.delegate.onEnd(safeSpan(span));
  }
  forceFlush() { return this.delegate.forceFlush(); }
  shutdown() { return this.delegate.shutdown(); }
}
// Next bundles instrumentation and route handlers separately. A module-local
// singleton makes after() flush a different (empty) SDK and loses serverless spans.
const runtime = globalThis as typeof globalThis & { hookaObservability?: { traces: NodeTracerProvider; meters: MeterProvider } };
export function startObservability(service: "web" | "worker", sentry?: Client) {
  const grafana = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== "true";
  if (runtime.hookaObservability || (!grafana && !sentry)) return;
  try {
    const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "https://telemetry.invalid");
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Invalid telemetry endpoint");
    const ratio = Number(process.env.HOOKA_TRACE_SAMPLE_RATIO || "0.1");
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error("Invalid sample ratio");
    const resource = resourceFromAttributes({ "service.name": `hooka-relay-${service}` });
    const sentryRatio = sentry ? sampleRatio(process.env.SENTRY_TRACES_SAMPLE_RATE) : 0;
    // The same deterministic decision survives persisted W3C context. Each export
    // keeps its own ratio; browser/upstream sampling flags cannot raise our quota.
    const decisionSampler = new TraceIdRatioBasedSampler(Math.max(grafana ? ratio : 0, sentryRatio));
    const sampler = sentry ? Object.assign(new SentrySampler(sentry), {
      shouldSample(parent: Context, traceId: string) { return wrapSamplingDecision({ context: parent, spanAttributes: {}, decision: decisionSampler.shouldSample(ROOT_CONTEXT, traceId).decision }); },
      toString() { return "HookaSentrySampler"; },
    }) : new TraceIdRatioBasedSampler(ratio);
    const processors: SpanProcessor[] = [];
    if (grafana) processors.push(new PrivateSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ timeoutMillis: 3000 }), { maxQueueSize: 512, maxExportBatchSize: 64, scheduledDelayMillis: 2000, exportTimeoutMillis: 4000 }), sentry ? ratio : undefined));
    if (sentry) processors.push(new PrivateSpanProcessor(new SentrySpanProcessor({ client: sentry, timeout: 2000 }), sentryRatio));
    const traces = new NodeTracerProvider({ resource, sampler, spanProcessors: processors });
    const meters = new MeterProvider({ resource, readers: grafana ? [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ timeoutMillis: 3000 }), exportIntervalMillis: 60000, exportTimeoutMillis: 4000 })] : [] });
    traces.register(sentry ? { contextManager: new SentryContextManager(), propagator: new SentryPropagator() } : undefined);
    metrics.setGlobalMeterProvider(meters); runtime.hookaObservability = { traces, meters };
  } catch { console.warn("Telemetry disabled: check OTLP configuration"); }
}
export async function flushObservability() {
  const providers = runtime.hookaObservability;
  if (providers) await Promise.allSettled([providers.traces.forceFlush(), providers.meters.forceFlush()]);
  await flush(2000).catch(() => false);
}
export async function stopObservability() {
  const providers = runtime.hookaObservability;
  // SentrySpanProcessor.shutdown clears its queue rather than exporting it.
  await flushObservability();
  if (providers) await Promise.allSettled([providers.traces.shutdown(), providers.meters.shutdown()]);
  await flush(2000).catch(() => false);
}
