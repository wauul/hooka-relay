import { context, trace, metrics, ROOT_CONTEXT, SpanStatusCode, isSpanContextValid, type Attributes, type Span } from "@opentelemetry/api";

const scope = "hooka-relay";
export function traceparent() {
  const span = trace.getSpan(context.active())?.spanContext();
  return span && isSpanContextValid(span) ? `00-${span.traceId}-${span.spanId}-${span.traceFlags.toString(16).padStart(2, "0")}` : undefined;
}
export function storedContext(value?: string | null) {
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])$/.exec(value || "");
  if (!match) return ROOT_CONTEXT;
  const span = { traceId: match[1], spanId: match[2], traceFlags: Number.parseInt(match[3], 16), isRemote: true };
  return isSpanContextValid(span) ? trace.setSpanContext(ROOT_CONTEXT, span) : ROOT_CONTEXT;
}
export function traced<T>(name: string, attributes: Attributes, run: (span: Span) => Promise<T>, parent?: string | null): Promise<T> {
  return trace.getTracer(scope).startActiveSpan(name, { attributes }, parent === undefined ? context.active() : storedContext(parent), async span => {
    try { return await run(span); }
    catch (error) {
      // Error text/stack can contain receiver URLs, tokens or payloads. Never export it.
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally { span.end(); }
  });
}
export function count(name: string, attributes: Attributes = {}) {
  metrics.getMeter(scope).createCounter(name).add(1, attributes);
}
export function addCount(name: string, value: number, attributes: Attributes = {}) {
  if (value > 0) metrics.getMeter(scope).createCounter(name).add(value, attributes);
}
export function gauge(name: string, value: number, attributes: Attributes = {}) {
  metrics.getMeter(scope).createGauge(name).record(value, attributes);
}
export function observe(name: string, value: number, unit = "s", attributes: Attributes = {}) {
  metrics.getMeter(scope).createHistogram(name, { unit }).record(value, attributes);
}
export function deliveryMetric(duration: number, outcome: "success" | "failure") {
  const meter = metrics.getMeter(scope);
  meter.createCounter("hooka.delivery.attempts").add(1, { outcome });
  meter.createHistogram("hooka.delivery.duration", { unit: "s" }).record(duration / 1000, { outcome });
}
export function queueDepth(depth: number) {
  metrics.getMeter(scope).createGauge("hooka.queue.depth").record(depth, { queue: "delivery-attempt-queue" });
}
