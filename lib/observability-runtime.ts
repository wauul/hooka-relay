import { metrics, type Context } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor, TraceIdRatioBasedSampler, type Span, type ReadableSpan, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";

// Defense in depth: framework instrumentation must never export route parameters,
// capability URLs, query strings, headers, SQL, exceptions or response bodies.
const allowed = new Set(["hooka.event.id", "hooka.delivery.id", "hooka.endpoint.id", "hooka.attempt", "hooka.outcome", "hooka.circuit", "hooka.delay_ms", "http.response.status_code", "http.request.method"]);
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
  constructor(private readonly delegate: SpanProcessor) {}
  onStart(span: Span, parent: Context) { this.delegate.onStart(span, parent); }
  onEnd(span: ReadableSpan) {
    if (span.instrumentationScope.name !== "hooka-relay" && span.attributes["next.span_type"] !== "BaseServer.handleRequest") return;
    this.delegate.onEnd(safeSpan(span));
  }
  forceFlush() { return this.delegate.forceFlush(); }
  shutdown() { return this.delegate.shutdown(); }
}
let providers: { traces: NodeTracerProvider; meters: MeterProvider } | undefined;
export function startObservability(service: "web" | "worker") {
  if (providers || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_SDK_DISABLED === "true") return;
  try {
    const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("Invalid telemetry endpoint");
    const ratio = Number(process.env.HOOKA_TRACE_SAMPLE_RATIO || "0.1");
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error("Invalid sample ratio");
    const resource = resourceFromAttributes({ "service.name": `hooka-relay-${service}` });
    const traces = new NodeTracerProvider({ resource, sampler: new TraceIdRatioBasedSampler(ratio), spanProcessors: [new PrivateSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ timeoutMillis: 3000 }), { maxQueueSize: 512, maxExportBatchSize: 64, scheduledDelayMillis: 2000, exportTimeoutMillis: 4000 }))] });
    const meters = new MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ timeoutMillis: 3000 }), exportIntervalMillis: 60000, exportTimeoutMillis: 4000 })] });
    traces.register(); metrics.setGlobalMeterProvider(meters); providers = { traces, meters };
  } catch { console.warn("Telemetry disabled: check OTLP configuration"); }
}
export async function flushObservability() {
  if (providers) await Promise.allSettled([providers.traces.forceFlush(), providers.meters.forceFlush()]);
}
export async function stopObservability() {
  if (providers) await Promise.allSettled([providers.traces.shutdown(), providers.meters.shutdown()]);
}
