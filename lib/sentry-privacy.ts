import type { Breadcrumb, ErrorEvent, Event, EventHint, SpanJSON } from "@sentry/core";

// Fail closed: arbitrary text (including exception messages) is never telemetry.
const operations = new Set(["api.events", "next.request", "api.request", "cli.request", "client.request", "client.interaction", "react.render", "server.request", "event.ingest", "outbox.enqueue", "delivery.attempt", "worker.consume", "broker.connect", "broker.channel", "broker.publish", "broker.inspect", "worker.maintenance", "worker.drain", "worker.recovery", "worker.notices", "worker.retention", "worker.shutdown", "worker.fatal", "live.receive", "live.message", "live.subscribe", "live.heartbeat", "live.close", "live.transport", "search.request", "status.request", "email.send", "diagnosis", "notification"]);
const errorTypes = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AggregateError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError", "PrismaClientRustPanicError"]);
const traceStatuses = new Set(["ok", "unknown_error", "internal_error", "cancelled", "deadline_exceeded", "unavailable", "resource_exhausted", "invalid_argument", "not_found", "permission_denied", "unauthenticated", "already_exists", "failed_precondition", "aborted", "out_of_range", "unimplemented", "data_loss", "unknown"]);
export const safeOperation = (value: unknown) => typeof value === "string" && operations.has(value) ? value : "api.request";
export function sensitiveRoute(value: string) {
  try {
    const path = decodeURIComponent(new URL(value, "https://hooka-relay.invalid").pathname);
    return /(?:^|\/)(portal|invites|invite|reset-password|forgot-password|verify-email|recover|recovery)(?:\/|$)/i.test(path) || /^\/api\/account\//.test(path);
  } catch { return true; }
}
const routeWords = new Set("api v1 applications endpoints events workspaces sources customers keys event-types schemas routing attempts receipts replay activity configuration test pause resume rotate-secret retry-policy signup login logout account search support-chat stats operator usage status docs privacy terms auth session csrf providers signin signout callback live me health".split(" "));
export function safeRoute(value: string) {
  try {
    const path = new URL(value.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /, ""), "https://hooka-relay.invalid").pathname;
    return path.split("/").map(part => !part || routeWords.has(part) ? part : "[id]").join("/").slice(0, 200);
  } catch { return "/[route]"; }
}
export function expectedError(error: unknown) {
  if (!(error instanceof Error)) return false;
  // These classes represent explicit validation/auth failures, never infrastructure.
  if (["ZodError", "InputLimitError", "PayloadSchemaError", "WorkspaceError", "ApiFailure", "LiveAuthError", "SupportRateLimitError"].includes(error.constructor.name)) return true;
  return ["UNAUTHORIZED", "NOT_FOUND", "FORBIDDEN", "KEY_GRACE_ACTIVE", "PORTAL_QUOTA", "body_limit", "empty_body", "Use a public HTTPS URL on port 443 without credentials.", "Internal hostnames are not allowed.", "Private and reserved addresses are not allowed.", "Endpoint URL exceeds 2048 characters."].includes(error.message) || error.message.startsWith("NEXT_REDIRECT;") || error.message.startsWith("NEXT_HTTP_ERROR_FALLBACK;");
}
export function safeTags(tags: Record<string, unknown> = {}) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (key === "operation") result.operation = safeOperation(value);
    if (key === "service" && ["web", "worker", "browser", "edge"].includes(String(value))) result.service = String(value);
    if (key === "outcome" && ["failure", "success", "retry", "dead_lettered", "delivered", "replay"].includes(String(value))) result.outcome = String(value);
    if (key === "attempt" && /^\d{1,6}$/.test(String(value))) result.attempt = String(value);
    if (["event_id", "delivery_id", "endpoint_id", "connection_id"].includes(key) && /^(?:[a-f0-9]{8}-[a-f0-9-]{27}|c[a-z0-9]{20,31})$/.test(String(value))) result[key] = String(value);
    if (key === "generation" && /^\d{1,6}$/.test(String(value))) result.generation = String(value);
  }
  return result;
}
export function privateBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // No console, DOM selectors, navigation URLs, HTTP URLs or messages.
  return crumb.category === "hooka.operation" ? { category: crumb.category, level: crumb.level, timestamp: crumb.timestamp, message: safeOperation(crumb.message) } : null;
}
function privateFrame(frame: NonNullable<NonNullable<Event["exception"]>["values"]>[number]["stacktrace"]) {
  return frame && { frames: frame.frames?.map(f => {
    // Retain artifact filenames/line numbers for source maps, drop code/vars/URLs.
    const filename = artifactFilename(f.filename || f.abs_path);
    return { filename, abs_path: filename, lineno: f.lineno, colno: f.colno, in_app: f.in_app, function: /^[\w.$ <>\[\]-]{1,120}$/.test(f.function || "") ? f.function : undefined };
  }) };
}
function artifactFilename(value?: string) {
  const filename = (value || "").replace(/\\/g, "/").replace(/[?#].*$/, "");
  const asset = filename.match(/\/_next\/static\/[\w/-]+\.(?:js|mjs)$/)?.[0];
  if (asset) return asset;
  const compiled = filename.match(/(?:^|\/)((?:dist\/(?:worker|lib)|\.next\/server)\/[\w/.[\]-]+\.(?:[cm]?js))$/)?.[1];
  if (compiled) return `app:///${compiled}`;
  const source = filename.match(/(?:^|\/)((?:app|lib|worker|components)\/[\w/.[\]-]+\.[jt]sx?)$/)?.[1];
  return source ? `app:///${source}` : undefined;
}
export function privateEvent<T extends Event>(event: T, hint?: EventHint, browserPath?: string): T | null {
  if (browserPath && sensitiveRoute(browserPath)) return null;
  if (hint && expectedError(hint.originalException)) return null;
  if (event.type === "transaction" && sensitiveRoute(event.transaction || "/")) return null;
  const tags = safeTags(event.tags);
  const values = event.exception?.values?.map(v => ({ type: errorTypes.has(v.type || "") ? v.type : "Error", value: "Unexpected application failure; details withheld", stacktrace: privateFrame(v.stacktrace), mechanism: v.mechanism ? { type: /^[\w.]{1,80}$/.test(v.mechanism.type) ? v.mechanism.type : "generic", handled: v.mechanism.handled } : undefined }));
  const trace = event.contexts?.trace;
  const contexts = trace ? { trace: { trace_id: /^[a-f0-9]{32}$/.test(trace.trace_id || "") ? trace.trace_id : undefined, span_id: /^[a-f0-9]{16}$/.test(trace.span_id || "") ? trace.span_id : undefined, parent_span_id: /^[a-f0-9]{16}$/.test(trace.parent_span_id || "") ? trace.parent_span_id : undefined, op: "hooka.operation", status: typeof trace.status === "string" && traceStatuses.has(trace.status) ? trace.status : undefined } } : undefined;
  // Construct a fresh allowlisted event: no request/user/extra/modules/SDK metadata.
  return {
    event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
    type: event.type, level: event.level, release: event.release, environment: event.environment,
    debug_meta: event.debug_meta ? { images: event.debug_meta.images?.map(image => ({ type: "sourcemap" as const, debug_id: /^[a-f0-9-]{36}$/.test(image.debug_id || "") ? image.debug_id : undefined, code_file: artifactFilename(image.code_file) })).filter(image => image.code_file && image.debug_id) } : undefined,
    exception: values ? { values } : undefined,
    message: event.message ? "Application diagnostic; details withheld" : undefined,
    tags, contexts, breadcrumbs: event.breadcrumbs?.flatMap(b => { const safe = privateBreadcrumb(b); return safe ? [safe] : []; }),
    fingerprint: event.type === "transaction" ? undefined : ["{{ default }}", tags.operation || "server.request"],
    transaction: event.transaction ? operations.has(event.transaction) || /^db\.[A-Za-z]+\.[A-Za-z]+$/.test(event.transaction) ? event.transaction : safeRoute(event.transaction) : undefined,
    transaction_info: event.transaction_info ? { source: "route" } : undefined,
    start_timestamp: event.start_timestamp, spans: event.spans?.map(privateSpan),
  } as T;
}
export function privateSpan(span: SpanJSON): SpanJSON {
  const data = safeTags({ attempt: span.data?.["hooka.attempt"], generation: span.data?.["hooka.generation"], outcome: span.data?.["hooka.outcome"] });
  return { trace_id: span.trace_id, span_id: span.span_id, parent_span_id: span.parent_span_id, start_timestamp: span.start_timestamp, timestamp: span.timestamp, status: traceStatuses.has(span.status || "") ? span.status : undefined, op: "hooka.operation", description: operations.has(span.description || "") || /^db\.[A-Za-z]+\.[A-Za-z]+$/.test(span.description || "") ? span.description : safeRoute(span.description || "/"), data };
}
export const beforeSend = (event: ErrorEvent, hint: EventHint) => privateEvent(event, hint);
