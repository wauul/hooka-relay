// Hand-authored from route handlers. Generation only serializes this contract.
import { writeFileSync } from "node:fs";
const string = { type: "string" }, integer = { type: "integer" };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required });
const array = items => ({ type: "array", items });
const date = { type: "string", format: "date-time" };
const nullable = schema => ({ ...schema, nullable: true });
const schemas = {
  EventInput: object({ customerId: { ...string, description: "Required when the authenticated application is customer-isolated." }, type: { ...string, minLength: 1, maxLength: 120, pattern: "^[A-Za-z0-9_.:-]+$" }, payload: {}, idempotencyKey: { ...string, minLength: 1, maxLength: 200, pattern: "^[!-~]+$" } }, ["type", "payload"]),
  EventResponse: object({ id: string, applicationId: string, customerId: nullable(string), type: string, payload: {}, idempotencyKey: string, operational: { type: "boolean" }, createdAt: date }),
  Customer: object({ id: string, externalId: string, name: string, createdAt: date }),
  CustomerInput: object({ externalId: string, name: string }),
  SchemaFailure: object({ path: string, message: string }),
  ErrorResponse: object({ error: string, retryAfter: integer, failures: array(ref("SchemaFailure")) }, ["error"]),
  ApplicationSummary: object({ id: string, name: string, createdAt: date }),
  Endpoint: object({ id: string, customerId: nullable(string), url: string, eventTypes: array(string), circuitState: { enum: ["CLOSED", "OPEN", "HALF_OPEN"], type: "string" }, status: { enum: ["ACTIVE", "PAUSED", "DISABLED"], type: "string" }, userStatus: { enum: ["ACTIVE", "PAUSED"], type: "string" }, environment: string, kind: { enum: ["BUSINESS", "OPERATIONAL"], type: "string" }, deliveryRatePerMinute: nullable(integer), signatureFormat: { enum: ["STANDARD"], type: "string" }, createdAt: date, successRate: nullable(integer) }),
  EndpointConfiguration: object({ environment: { ...string, minLength: 1, maxLength: 64 }, kind: { type: "string", enum: ["BUSINESS", "OPERATIONAL"] }, customHeaders: { type: "object", maxProperties: 10, additionalProperties: { ...string, maxLength: 1024 }, description: "ASCII values; protocol/hop-by-hop headers forbidden. At most 8 KiB combined. Encrypted at rest." }, deliveryRatePerMinute: { ...nullable(integer), minimum: 1, maximum: 6000 }, transform: { ...nullable(string), maxLength: 4096, description: "QuickJS function expression, e.g. p => ({id: p.orderId}). No host APIs." } }, []),
  EndpointCreate: { allOf: [ref("EndpointConfiguration"), object({ customerId: { ...string, description: "Required for isolated applications." }, url: { ...string, format: "uri", maxLength: 2000, description: "Public HTTPS on port 443; every resolved address must be public." }, eventTypes: { ...array({ ...string, maxLength: 120 }), minItems: 1, maxItems: 50, default: ["*"] } }, ["url"])] },
  EndpointCreated: object({ endpoint: object({ id: string, url: string, eventTypes: array(string), signatureFormat: string, environment: string, status: string, secret: { ...string, description: "Signing secret. Treat as a credential." } }) }),
  EndpointState: object({ id: string, status: string, environment: string }),
  SigningRotation: object({ secret: string, secretVersion: integer, previousSecretExpiresAt: date }),
  ReplayInput: object({ endpointId: string }, []),
  ReplayResponse: object({ eventId: string, generation: integer, queued: integer }),
  RecoveryInput: object({ since: date, endpointId: string }, ["since"]),
  RecoveryJob: object({ id: string, applicationId: string, endpointId: nullable(string), since: date, until: date, status: { type: "string", enum: ["PENDING", "COMPLETE"] }, queued: integer, createdAt: date }),
  EventTypeInput: object({ eventType: { ...string, maxLength: 120, pattern: "^[A-Za-z0-9_.:-]+$" }, description: { ...string, maxLength: 2000 }, schema: { description: "Optional restricted JSON Schema; null removes active validation. Immutable catalog version still retained." } }, ["eventType", "description"]),
  EventTypeVersion: object({ id: string, applicationId: string, eventType: string, description: string, schema: {}, version: integer, createdAt: date }),
  Backlog: object({ events: array(ref("EventResponse")), hasMore: { type: "boolean" }, nextCursor: nullable(string) }),
  Attempt: object({ id: string, eventId: string, endpointId: string, deliveryId: nullable(string), attemptNumber: integer, status: string, httpStatusCode: nullable(integer), durationMs: nullable(integer), createdAt: date, event: object({ type: string }), endpoint: object({ url: string, status: string, environment: string, circuitState: string }) }),
  Attempts: object({ attempts: array(ref("Attempt")), nextCursor: nullable(string), hasMore: { type: "boolean" } }),
  Delivery: object({ id: string, eventId: string, endpointId: string, generation: integer, attemptNumber: integer, status: string, dueAt: date, endpoint: { type: "object", description: "Endpoint selection with stored ACTIVE/PAUSED status and circuitState." }, attempts: integer, lastAttempt: { type: "object", nullable: true } }),
  EventDetails: object({ event: ref("EventResponse"), generation: integer, deliveries: array(ref("Delivery")) }),
  WebhookSourceCreate: object({ name: { ...string, maxLength: 100 }, customerId: string, provider: { type: "string", enum: ["STRIPE", "GITHUB", "SLACK", "SHOPIFY", "TWILIO", "CUSTOM"] } }),
  WebhookSourceUpdate: object({ name: string, providerSecret: string, destinationUrl: { ...string, format: "uri" }, manualConfig: { type: "object", description: "CUSTOM only: signatureHeader, algorithm (sha256/sha1), encoding (hex/base64), optional signaturePrefix, signedPayload (body/timestamp-body), timestampHeader and timestampFormat." }, status: { type: "string", enum: ["ACTIVE", "PAUSED"] } }, []),
  WebhookSource: object({ id: string, applicationId: string, customerId: string, name: string, provider: string, status: string, destinationUrl: nullable(string), endpointId: nullable(string), lastEventReceivedAt: nullable(date), lastVerifiedAt: nullable(date) }),
  InboundAck: object({ id: string }),
};
const paths = {};
function add(path, method, summary, response, { body, code = 200, description = "", parameters = [] } = {}) {
  const pathParameters = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: "path", required: true, schema: string }));
  (paths[path] ??= {})[method] = {
    tags: [path.includes("/endpoints") ? "Endpoints" : path.includes("event-types") ? "Event catalog" : path.includes("recovery") ? "Recovery" : "Events"],
    summary, description, operationId: `${method}_${path.replace(/[^\w]+/g, "_")}`,
    parameters: [...pathParameters, ...parameters],
    ...(body ? { requestBody: { required: true, content: { "application/json": { schema: body } } } } : {}),
    responses: { [code]: { description: "Success", content: { "application/json": { schema: response } } },
      ...Object.fromEntries([400,401,403,404,409,413,429,503].map(status => [status, { description: ({400:"Invalid input or schema mismatch",401:"Missing or invalid API key",403:"Key scope does not permit this action",404:"Resource not found in this application",409:"Conflicting active grace period or recovery job",413:"Request body too large",429:"Rate limit exceeded",503:"Service temporarily unavailable"})[status], ...(status === 429 ? { headers: { "Retry-After": { schema: string, description: "Seconds before retry, when provided by the limiter." } } } : {}), content: { "application/json": { schema: ref("ErrorResponse") } } }])) },
  };
}
const query = (name, schema, description) => ({ name, in: "query", schema, description });
add("/api/v1/events", "post", "Durably ingest an event", ref("EventResponse"), { body: ref("EventInput"), code: 202, description: "Ingest-only or existing unscoped key. Maximum 256 KiB and depth 32. Per-IP and per-application limits (default 100/minute per application). Duplicate idempotencyKey returns the original event before schema validation. Matching paused endpoints receive no delivery intent; explicit replay is required later." });
add("/api/v1/me", "get", "Inspect the authenticated application", object({ application: ref("ApplicationSummary") }));
add("/api/v1/applications/{id}/customers", "get", "List this application's customers", array(ref("Customer")));
add("/api/v1/applications/{id}/customers", "post", "Create a customer", ref("Customer"), { body: ref("CustomerInput"), code: 201, description: "Isolated applications only; application API key with manage scope required." });
add("/api/v1/endpoints", "get", "List endpoints with 24-hour success rate", object({ endpoints: array(ref("Endpoint")) }));
add("/api/v1/endpoints", "post", "Register an endpoint", ref("EndpointCreated"), { body: ref("EndpointCreate"), code: 201, description: "Existing unscoped key required. New endpoints use STANDARD signatures. Creating OPERATIONAL endpoints subscribes to relay-generated lifecycle events only." });
for (const action of ["pause", "resume", "configuration"]) add(`/api/v1/endpoints/{id}/${action}`, "patch", `${action} endpoint`, ref("EndpointState"), { ...(action === "configuration" ? { body: ref("EndpointConfiguration") } : {}), description: "Existing unscoped key required. Resume does not replay events missed while paused. DISABLED is the circuit-open view; automatic circuit probes remain enabled." });
add("/api/v1/endpoints/{id}/rotate-secret", "post", "Rotate signing secret", ref("SigningRotation"), { description: "Existing unscoped key required. Dual signatures for seven days by default; a second rotation during grace returns 409. Audited." });
add("/api/v1/attempts", "get", "Tail delivery attempts", ref("Attempts"), { parameters: [query("endpoint", string, "Optional endpoint ID"), query("after", string, "Opaque nextCursor from previous response. First page contains latest 100 in ascending order.")] });
add("/api/v1/events/{id}", "get", "Inspect one event delivery generation", ref("EventDetails"), { parameters: [query("generation", { ...integer, minimum: 0 }, "Defaults to latest generation")] });
add("/api/v1/events/{id}/replay", "post", "Replay an event to active matching endpoints", ref("ReplayResponse"), { body: ref("ReplayInput"), code: 202, description: "Existing unscoped key required. Empty body is also accepted. Reuses stable event ID, creates a new delivery generation through the durable outbox." });
paths["/api/v1/events/{id}/replay"].post.requestBody.required = false;
add("/api/v1/applications/{id}/events", "get", "Pull missed-event backlog", ref("Backlog"), { parameters: [query("since", string, "ISO timestamp or event ID in this application (exclusive)."), query("endpoint_id", string, "Historical deliveries or currently matching subscriptions, including events missed while paused."), query("cursor", string, "Opaque nextCursor"), query("limit", { ...integer, minimum: 1, maximum: 100, default: 50 }, "Page size")] });
add("/api/v1/applications/{id}/event-types", "get", "List event type versions", array(ref("EventTypeVersion")));
add("/api/v1/applications/{id}/event-types", "post", "Publish event type version and active schema", ref("EventTypeVersion"), { body: ref("EventTypeInput"), code: 201 });
add("/api/v1/applications/{id}/recovery", "get", "List latest 20 recovery jobs", array(ref("RecoveryJob")));
add("/api/v1/applications/{id}/recovery", "post", "Queue bulk recovery of latest failed deliveries", ref("RecoveryJob"), { body: ref("RecoveryInput"), code: 202, description: "Existing unscoped key required. One pending job and one admission/minute per application. Worker drains five eligible failures/job/pass, staggering deliveries by one second." });
add("/api/applications/{id}/sources", "get", "List inbound webhook sources", array(ref("WebhookSource")), { description: "Dashboard session and workspace membership required. Signing secrets are never returned." });
add("/api/applications/{id}/sources", "post", "Create a webhook source and unique ingestion URL", object({ id: string, ingestionUrl: string }), { body: ref("WebhookSourceCreate"), code: 201, description: "Dashboard ADMIN/OWNER session required. The source starts in SETUP_IN_PROGRESS." });
add("/api/sources/{id}", "get", "Inspect source and recent delivery attempts", ref("WebhookSource"), { description: "Dashboard session required. Includes the most recent 30 existing DeliveryAttempt records." });
add("/api/sources/{id}", "patch", "Configure or pause a source", ref("WebhookSource"), { body: ref("WebhookSourceUpdate"), description: "Dashboard ADMIN/OWNER session required. Destination uses the existing public HTTPS SSRF validator; the provider secret is encrypted." });
add("/api/sources/{id}/simulate", "post", "Queue an explicitly simulated test event", object({ eventId: string, simulated: { type: "boolean" } }), { body: object({}, []), code: 202, description: "Dashboard ADMIN/OWNER session required. Simulation tests forwarding through the existing delivery pipeline, not provider signature verification." });
add("/api/inbound/{ingestionToken}", "post", "Receive a signed provider webhook", ref("InboundAck"), { body: { type: "object" }, code: 202, description: "Public URL, no API key. Provider-specific signatures are mandatory. Supports signed webhooks from the provider catalog and configured custom HMAC. Maximum 256 KiB; JSON depth 32; IP and application event limits apply. Verified events enter the existing Event → Delivery → DeliveryAttempt pipeline." });
for (const path of ["/api/applications/{id}/sources", "/api/sources/{id}", "/api/sources/{id}/simulate", "/api/inbound/{ingestionToken}"]) {
  for (const operation of Object.values(paths[path])) operation.tags = ["Webhook sources"];
}
paths["/api/inbound/{ingestionToken}"].post.security = [];
paths["/api/inbound/{ingestionToken}"].post.requestBody.content["application/x-www-form-urlencoded"] = { schema: { type: "object", additionalProperties: string } };
for (const path of ["/api/applications/{id}/sources", "/api/sources/{id}", "/api/sources/{id}/simulate"]) {
  for (const operation of Object.values(paths[path])) operation.security = [];
}
const spec = {
  openapi: "3.0.3", info: { title: "Hooka Relay API", version: "1.0.0", description: "Public integration API. Bearer and X-API-Key are alternatives. Read-only keys permit GET; ingest-only keys permit POST /api/v1/events. Existing unscoped keys retain all integration operations. Dashboard session APIs use separate workspace role and same-origin checks." },
  servers: [{ url: "/", description: "This Hooka Relay deployment" }],
  security: [{ bearerAuth: [] }, { apiKey: [] }], paths,
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" }, apiKey: { type: "apiKey", in: "header", name: "X-API-Key" } }, schemas },
};
writeFileSync(new URL("../docs/openapi.json", import.meta.url), JSON.stringify(spec, null, 2) + "\n");
