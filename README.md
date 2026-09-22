# Hooka Relay

[![CI](https://github.com/wauul/hooka-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/wauul/hooka-relay/actions/workflows/ci.yml)

Hooka Relay is a webhook delivery service for teams. Create an application, register one or more HTTPS endpoints, and send events through the API. The dashboard keeps delivery history, endpoint health, and replay tools in one place.

**Links:** [App](https://hooka-relay.vercel.app) · [Documentation](https://hooka-relay.vercel.app/docs) · [CLI](https://github.com/wauul/hooka-cli)

## What it does

- Delivers events to endpoints subscribed to a type or wildcard (`*`)
- Persists events and delivery work before acknowledging an API request
- Retries failed deliveries through RabbitMQ with increasing delays
- Signs each request with an endpoint-specific HMAC secret
- Provides delivery logs, replays, endpoint pausing, and circuit breaking
- Supports shared workspaces with owner, admin, and member roles

Deliveries are at least once. Webhook consumers should verify signatures and use the idempotency key to make processing safe to retry.

## Requirements

- Node.js 22 or newer
- pnpm 10
- PostgreSQL
- RabbitMQ

## Local development

```sh
corepack enable
pnpm install
cp .env.example .env
```

Set the required connection details in `.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
RABBITMQ_URL="amqps://USER:PASSWORD@HOST/VHOST"
NEXTAUTH_SECRET="replace-with-a-random-secret"
NEXTAUTH_URL="http://localhost:3000"
```

Apply migrations, then run the web app and worker in separate terminals:

```sh
pnpm db:migrate
pnpm dev
```

```sh
pnpm worker
```

The app is available at `http://localhost:3000`. The worker health endpoint is `http://localhost:8080/health`.

## Sending events

After creating an application and endpoint in the dashboard, send an event with the application API key:

```sh
curl -X POST http://localhost:3000/api/v1/events \
  -H "Authorization: Bearer hr_live_your_application_key" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "order.shipped",
    "idempotencyKey": "order-1042-shipped",
    "payload": { "orderId": "ord_1042" }
  }'
```

`X-API-Key` may be used instead of the `Authorization` header. A successful request returns `202 Accepted`. Event payloads are limited to 256 KB.

## Receiving webhooks

New endpoints use [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md). The signed content is `webhook-id + "." + webhook-timestamp + "." + exact raw body`, with a base64 HMAC-SHA256 signature. `webhook-id` is the stored Event ID, stable across retries and replays. Verify first, then atomically deduplicate this authenticated ID; `X-Idempotency-Key` is producer metadata, not a trusted receiver deduplication key.

```js
import { Webhook } from 'standardwebhooks';
const verifier = new Webhook(process.env.WEBHOOK_SECRET); // whsec_... from dashboard
const payload = verifier.verify(rawBody, {
  'webhook-id': request.headers['webhook-id'],
  'webhook-timestamp': request.headers['webhook-timestamp'],
  'webhook-signature': request.headers['webhook-signature'],
});
// Atomically record webhook-id with your business operation; duplicates return 2xx.
```

The reference verifier enforces a five-minute timestamp tolerance. Keep receiver clocks synchronized; each attempt gets a fresh timestamp. `X-Webhook-Event`, `X-Webhook-Endpoint`, and `X-Idempotency-Key` remain informational headers.

Existing endpoints keep `LEGACY`: `X-Webhook-Signature: t=UNIX_SECONDS,v1=HEX`, signing `timestamp + "." + raw body` with the existing secret. To migrate, prepare your receiver for Standard Webhooks, switch the endpoint's signing format in the dashboard (or `PATCH /api/v1/endpoints/:id/signature-format` with `{ "signatureFormat": "STANDARD" }`), and use the displayed `whsec_...` representation. This encodes the same key bytes, not a new secret. Legacy mode cannot authenticate the producer idempotency header; use a trusted identifier inside the signed payload until migrated. Never fall back to the older body-only format.

### Signing-secret rotation

ADMIN/OWNER can `POST /api/endpoints/:id/rotate-secret`; application API clients use `/api/v1/endpoints/:id/rotate-secret`. Default grace is seven days (`SIGNING_SECRET_GRACE_HOURS=168`). Standard deliveries include both signatures in `webhook-signature`, so either old or new key verifies. Legacy deliveries retain the old key in `X-Webhook-Signature` during grace and add `X-Webhook-Signature-Current` for the new key. After expiry only the current key signs. A second rotation during grace returns 409 to avoid invalidating an integrated receiver early. The worker clears expired previous secrets. Rotations, format changes, and secret display are recorded without secret values in `AuditLog`.

Encryption migration and operational rollout: [SECURITY.md](SECURITY.md#endpoint-bound-signing-secrets). Architecture decisions: [ADR index](docs/adr/README.md).

## Delivery policy

An unsuccessful delivery is retried up to five times in total. Retries are scheduled after 30 seconds, 2 minutes, 5 minutes, and 15 minutes. Each outbound request has a 10-second timeout; non-2xx responses count as failures.

After repeated failures, the endpoint circuit opens temporarily to avoid sending more traffic to an unhealthy receiver. The worker later performs a recovery probe. Events can also be replayed from the dashboard.

## Workspaces

Applications belong to a workspace. Workspace owners and admins can manage applications, endpoints, and membership; members can inspect deliveries and send test events. Invitations are delivered by email when `RESEND_API_KEY` and `RESEND_FROM` are configured.

## Quality checks

```sh
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:coverage
pnpm build
```

Integration tests use Testcontainers and require Docker Desktop with Linux containers, or another compatible Docker daemon.

## Deployment

Deploy the Next.js application and the worker separately. The worker image is defined in `Dockerfile.worker`; both services must use the same PostgreSQL database and RabbitMQ broker.

```sh
pnpm db:migrate
docker build -f Dockerfile.worker -t hooka-relay-worker .
docker run --rm -p 8080:8080 --env-file .env hooka-relay-worker
```

## Stack

Next.js, React, TypeScript, Prisma, PostgreSQL, RabbitMQ, NextAuth, Tailwind CSS, and Vitest.

## Security hardening

Phase 1 hardening was deployed and verified on 2026-09-21 before Phase 2 began. See [SECURITY.md](SECURITY.md) for controls, attack scenarios, verification steps and the database role audit. See [the troubleshooting FAQ](docs/faq.md) for common delivery and configuration questions.


### Security release configuration

New settings: `ENDPOINT_SECRET_ENCRYPTION_KEY` (required, identical on web/worker; 32 random bytes encoded as hex), `EVENTS_IP_LIMIT_PER_MINUTE` (1000), and `AUTH_IP_LIMIT_PER_MINUTE` (20). API keys are shown only when created/rotated and stored as SHA-256 digests; signing secrets are encrypted. The previous API key remains valid during its configured grace period.

The production security migration was completed on 2026-09-21. Other existing installations must follow the offline credential migration and receiver signature update in [SECURITY.md](SECURITY.md) before upgrading. Request bodies over 256 KiB return 413; JSON depth over 32 returns 400. IP throttling runs before authentication and returns 429 with `Retry-After: 60` and `{ "error": "Too many requests. Try again shortly.", "retryAfter": 60 }`. The existing per-application admission limit is separate.

## Customer portal

Workspace admins can enable a private customer link from an application page. Visitors need no account: they can register public HTTPS endpoints, inspect their signing secrets and recent delivery results, pause/resume, and delete their own endpoints. Each visitor receives a separate HttpOnly browser credential; possessing the shared application link alone does not grant access to other visitors' or dashboard-created endpoints. Clearing cookies or changing browsers loses that visitor access; the workspace admin can still manage the endpoints.

Only share the link with people authorized to receive the application's matching events. Subscription filtering is by event type, not by a customer field inside the payload. Use separate applications when event data must be isolated between customers. Portal endpoint registration has the same SSRF protection, an 8 KiB request limit, maximum JSON depth 32, a separate `PORTAL_IP_LIMIT_PER_MINUTE` quota (30 by default), and caps of 10 endpoints per visitor / 50 portal endpoints per application. Pausing prevents new delivery work; resuming does not backfill missed events.

Portal tokens are stored as digests plus encrypted copies for authorized admin sharing. Portal and invitation pages omit analytics and send `Referrer-Policy: no-referrer`. API responses are not cacheable. Anonymous visitor credentials are not recoverable from the database.

The portal is the first Phase 2 feature. See the support assistant section below for documentation-based help.

## Event payload schemas

Owners/admins can add, replace and remove schemas in an application's Event schemas panel (`GET/PUT/DELETE /api/applications/:id/schemas`). Members can view schemas. The request body for PUT is `{ "eventType": "order.shipped", "schema": { "type": "object", "properties": { "orderId": { "type": "string" } }, "required": ["orderId"] } }`; DELETE takes `eventType` only.

Ingestion and dashboard test events validate the payload with Ajv when that exact type has a schema. Other types pass through. Invalid payloads return 400 with `{ "error": "Payload does not match the event schema", "failures": [{ "path": "/orderId", "message": "must be string" }] }` and create no event or delivery intent. Validation stops at the first error to bound work. Previously accepted idempotency keys still return their original event regardless of later schema changes.

Schemas use a bounded draft-07 subset: types, object properties/required/additionalProperties, array items and bounds, string length, numeric bounds/multipleOf, enum/const, title/description. Regex, formats, references, combinators and uniqueItems are rejected to prevent expensive untrusted validation. Definitions are capped at 16 KiB, depth 12, 250 schema nodes, 100 enum options and 50 types per application. Payloads are never coerced or modified. These limits follow [Ajv's security considerations](https://ajv.js.org/security.html).

## Endpoint retry policies

Owners/admins choose a policy in Endpoint configuration or `PATCH /api/endpoints/:id/retry-policy` with `{ "retryPolicy": "AGGRESSIVE" }`. Members can view it.

| Policy | Total HTTP attempts | Delays after failures |
| --- | --- | --- |
| STANDARD (default) | 5 | 30s, 2m, 5m, 15m |
| AGGRESSIVE | 7 | 30s, 30s, 30s, 2m, 2m, 5m |
| RELAXED | 4 | 5m, 15m, 30m |

These presets reuse the exact existing durable TTL+DLX queues. No plugins, extra infrastructure, or arbitrary custom queue intervals are required. Policy changes affect subsequent failures; already scheduled deliveries retain their due time, and attempt counts never reset. Circuit-open skips still consume no HTTP attempt and the existing cooldown can extend the effective schedule. Standard behavior is unchanged for all migrated endpoints.

## Public status

[/status](https://hooka-relay.vercel.app/status) shows anonymized aggregate HTTP-attempt success over 24 hours, cached for 60 seconds. It detects an incident after two consecutive completed five-minute windows each have at least five attempts and success below 90%. Sparse/missing windows break the sequence. Circuit-open skips are excluded; failing customer receivers and intentionally failing demo receivers count. This is an observed delivery metric, not a platform-uptime SLA. No customer identities, URLs or payloads are exposed.



## Hooka Relay Support Assistant

The dashboard and docs include a product-only support widget. It answers from README.md, SECURITY.md, docs/api.md and docs/faq.md. It cannot inspect your workspace or perform actions. Do not submit secrets. Questions are sent to Groq; local MiniLM embeddings use `@xenova/transformers`, with documentation vectors stored in the existing Postgres pgvector extension. No paid service or additional database is required.

Every valid, admitted question first receives a small classification call. Off-topic/ambiguous questions receive a fixed decline and **never** run embedding, retrieval or full generation. In-scope questions use cached answers or retrieve up to four relevant documentation chunks; missing evidence returns an explanation. This keeps the assistant focused and bounds token cost. Model classification is not a perfect security boundary: a separate grounded-generation prompt, quotas, token caps and no tools provide additional controls.

`POST /api/support-chat` accepts `{ "question": "Why is my Hooka Relay circuit open?", "history": [] }`. Questions are capped at 500 characters, history at three question/answer exchanges, and bodies at 12 KiB. Fixed-window limits default to 10/minute and 100/day per IP and authenticated user, plus 1000/day globally. Limits apply before model calls, including cache hits. Classifier output is capped at 256 tokens and generation at 768; neither automatically retries. Unavailable providers return 503. Quotas return 429 with a conservative Retry-After. The normal event quotas are unchanged.

Whitespace/case-equivalent questions reuse answers for up to 24 hours; history and corpus revision are included in cache keys. Every classification records its boolean/reason and cache outcome for 30 days. Raw questions/history are not stored as columns; classifier reasons can summarize their content. `GET /api/support-chat/stats` exposes total classifications, declined percentage and cache-hit rate only to the comma-separated user IDs in `SUPPORT_ADMIN_USER_IDS`. Workspace administrator status alone is insufficient. A cache/fresh indicator appears only in development.

Setup: run `npm run db:migrate` using the schema-owner connection (enables pgvector), grant the runtime role SELECT on SupportDocument/SupportCorpus and SELECT/INSERT/UPDATE/DELETE on SupportAnswerCache/SupportDecision, then run `npm run support:ingest` with the owner connection. Re-run ingestion after documentation changes; it atomically publishes the corpus and invalidates cached answers. The first embedding call downloads the quantized Xenova/all-MiniLM-L6-v2 model to the process cache (`/tmp` on Vercel); cold starts can take longer. CI mocks model/embedding calls and uses disposable pgvector Postgres.

Environment: existing `GROQ_API_KEY`; optional `SUPPORT_GROQ_MODEL` (default `openai/gpt-oss-20b`, because the requested `llama-3.1-8b-instant` is no longer in Groq's catalog), `SUPPORT_ADMIN_USER_IDS`, `SUPPORT_LIMIT_PER_MINUTE`, `SUPPORT_LIMIT_PER_DAY`, `SUPPORT_GLOBAL_LIMIT_PER_DAY`, and `HF_HOME` for a local model-cache directory. Keep the Groq account on its free plan; no paid fallback is configured.

The web application runs Next.js 16.3.5. Development and production builds explicitly retain webpack; the existing edge middleware remains in place. ESLint runs separately through its flat configuration and CI.


## Recovery and endpoint lifecycle

`GET /api/v1/applications/:id/events?since=<ISO timestamp or event ID>&endpoint_id=<id>&limit=50` returns `{ events, hasMore, nextCursor }`. Pass `cursor=nextCursor` for the next page (maximum 100); ordering is by creation time and ID. A read-only or existing unscoped application key is required. Dashboard sessions use `/api/applications/:id/events`. Endpoint filters include historical delivery matches and events matching current subscriptions, including events received while paused; historical subscription changes cannot be reconstructed for events never enqueued. This is a pull API, not a retry-policy change.

`POST /api/v1/applications/:id/recovery` with `{ "since": "2026-01-01T00:00:00Z", "endpointId": "optional" }` starts a durable recovery job and returns 202 with its ID/status. `GET` lists job progress. It selects the latest exhausted (`DEAD_LETTERED`) generation only, up to the job's start time. Pending/successful generations are excluded. The worker schedules batches of at most five per job every five seconds (up to ten jobs per pass), with staggered due times; endpoint throttles also apply. One job per application may run at a time, and starts are limited to one per minute. Dashboard routes use the same path without `/v1` and require ADMIN/OWNER for starting recovery. Single-event replay and bulk recovery share the original event lock, generation allocation and durable outbox.

Endpoint API responses now expose `ACTIVE`, `PAUSED`, or `DISABLED`, plus `userStatus` for the stored user choice. `DISABLED` means the circuit is open, not permanent deactivation: the existing ten-minute cooldown and automatic recovery probe remain unchanged. `PATCH /api/v1/endpoints/:id/pause` and `/resume` control user pause. Pausing prevents new delivery intents and holds queued attempts without spending retries or creating skip logs; a request already in flight may finish. Resume releases queued work but does not backfill events received while paused. Select those events from the backlog and replay explicitly.

`PATCH /api/v1/endpoints/:id/configuration` accepts:

- `environment`: freeform label, up to 64 characters; defaults to `production`. The dashboard suggests development/staging/production.
- `customHeaders`: up to ten headers / 8 KiB; protocol and connection headers are reserved. Values are encrypted at rest and redacted in attempt logs.
- `deliveryRatePerMinute`: 1–6000 or null (no throttle). The existing endpoint lease enforces spacing across workers. Throttled wakeups use the outbox watchdog, so low rates can add about 20 seconds of scheduling latency.
- `transform`: a synchronous function expression such as `payload => ({ order: payload.orderId })`, or null. It runs in QuickJS WebAssembly before signing, with no Node/network/filesystem APIs, a 25 ms execution deadline, 16 MiB heap, 128 KiB stack, and 256 KiB/32-level JSON output limit. Code is limited to 4096 characters. Transform errors become failed attempts under the existing retry/circuit policy; the original stored event is unchanged.
- `kind`: `BUSINESS` (default) or `OPERATIONAL`. Operational endpoints subscribe to `endpoint.disabled`, `endpoint.re-enabled`, and `message.failed` (final exhaustion only), or `*`. Notifications use the existing outbox and delivery pipeline. Operational delivery failures do not emit further operational events.

Session configuration routes omit `/v1` and require ADMIN/OWNER. The dashboard displays circuit incidents with a recovery link. The worker also sends the workspace OWNER a notification through the existing Resend account; configure `RESEND_API_KEY`, `RESEND_FROM`, and `NEXTAUTH_URL` on the worker as well as the web app. Failed email sends retry up to five times; the dashboard banner remains available.

Retry timing defaults are unchanged. Optional `RETRY_STANDARD_QUEUES`, `RETRY_AGGRESSIVE_QUEUES`, and `RETRY_RELAXED_QUEUES` accept comma-separated existing queue names (1–10 intervals). Supported names: `retry-delay-30s`, `retry-delay-2m`, `retry-delay-5m`, `retry-delay-15m`, `retry-delay-30m`. Queue TTLs are never rewritten; already scheduled deliveries keep their due times. Configure the worker deliberately when changing a schedule.

### Versioned event types and scoped keys

The dashboard event catalog and `GET/POST /api/v1/applications/:id/event-types` expose descriptions, optional schemas, and immutable versions. Publishing `{ eventType, description, schema? }` makes that version's schema active; null/omitted schema disables validation. Existing schema-editor changes also create catalog versions. Existing schemas are imported as version 1. Free-form event types still work; duplicate idempotency keys still return the original event before validation. Catalog listing returns up to 500 versions; at most 50 distinct event types may be defined.

ADMIN/OWNER can create/list/revoke up to 20 extra keys through `/api/applications/:id/keys`. Keys are SHA-256 hashed and shown once, with optional expiry and last-use tracking. `READ_ONLY` permits GET management/history APIs; `INGEST_ONLY` permits POST `/api/v1/events`; neither can change configuration or replay. Existing unscoped keys retain their original full access and rotation behavior. All keys share the application's ingestion quota.
## Official SDKs and interactive API reference

The [Node SDK](packages/node/README.md) (`hooka-relay-node`) and [Python SDK](packages/python/README.md) (`hooka-relay-python`) provide typed event submission and Standard Webhooks reference verification. Both include queue-and-drain receiver examples, explicit idempotent retry guidance, and ordering limitations. They make no automatic retries. Keep publishing keys on your server.

The integration API contract is [OpenAPI 3.0](docs/openapi.json), available at `/openapi.json` and in the [interactive documentation](https://hooka-relay.vercel.app/docs#api-reference). Try-it requests operate on the current deployment: use a test application key. Authorization is kept in page memory, not local storage. Run `npm run sdk:generate` after editing `scripts/openapi.mjs`; CI rejects generated model drift and tests independently built packages.

SDK releases use `.github/workflows/publish-sdks.yml` and require successful CI for the exact master commit. Temporary `NPM_TOKEN` and `PYPI_API_TOKEN` bootstrap secrets are used only with the explicit bootstrap option; normal releases use registry trusted publishing bound to this repository and workflow.

### OpenTelemetry and Grafana

[Live operator dashboard](https://happybadger1637.grafana.net/d/hooka-relay) (Grafana sign-in required).

The web and worker export OTLP/HTTP traces and metrics when `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are configured. Leave the endpoint blank (or set `OTEL_SDK_DISABLED=true`) to disable export. Use a Grafana Cloud free stack and a stack-scoped token with only `metrics:write` and `traces:write`; no collector or paid Application Observability product is required. Headers use `Authorization=Basic%20<base64(instance-id:token)>`. Keep this value in server environment secrets, never `NEXT_PUBLIC_*`.

`HOOKA_TRACE_SAMPLE_RATIO` defaults to `0.1` (10%); metrics are unsampled. Trace context is committed with each event, so ingestion, outbox enqueue, worker attempts, retries, circuit decisions and final outcomes stay connected after restarts. Ingestion returns `X-Trace-Id` when tracing is enabled. Old events without context start new traces. Export outages never block delivery success. Next request spans have generic names; API ingestion flushes after responding, while other serverless request traces are best effort.

Import [`docs/grafana-dashboard.json`](docs/grafana-dashboard.json) into Grafana and select your Prometheus source. It shows attempt success rate, p50/p95/p99 HTTP duration, retry volume by delay, queue depth, final outcomes and circuit transitions by endpoint. Metrics export every minute, so allow two collection intervals for rate panels. Queue depth counts ready messages, not unacknowledged jobs or TTL queues.

Only opaque event/delivery/endpoint IDs and bounded operational labels leave the app. Payloads, receiver URLs, headers, email, exception text and capability links are excluded. Keep Grafana operator-only; this is not a tenant-facing view. The free tier has ingestion/retention limits: monitor usage and reduce sampling when needed; no automatic paid upgrade is configured. See the [telemetry ADR](docs/adr/2026-09-22-observability.md).

### Auto-Heal MVP: diagnose a pattern, then verify a fix

Endpoint delivery pages compare recent HTTP attempts and state when the observed failure streak began, changes in status codes, latency, redirects and captured response size. A window with no preceding success is labeled “since at least”; the app does not invent an earlier start. Circuit-open skips do not count as HTTP attempts. This deterministic evidence works without Groq. The existing Groq diagnosis runs after three consecutive failures, at most once per endpoint per minute after a successful diagnosis, using the last 20 HTTP attempts for pattern detection and at most eight 400-character response excerpts. Output is capped at 700 completion tokens. Failed model requests have no automatic retry; the normal worker may try diagnosis again on a later failed delivery. Receiver error bodies still go to Groq, so keep sensitive data out of them.

**Send synthetic test** calls `POST /api/endpoints/:id/test` with `{}` using a workspace session (OWNER, ADMIN or MEMBER). It creates a synthetic `hooka.test` event with `{ hookaTest: true, sentAt: <ISO time> }` for that endpoint only, regardless of its subscriptions. It is a real request to the configured URL, using current signing keys including any rotation grace, custom headers and transform. It reuses ingestion, schema validation, the durable outbox, leases, SSRF checks and the existing worker retry/circuit paths. No alternate delivery client or circuit reset is introduced. Paused or non-closed circuits return 409. Five tests per endpoint per fixed minute and the normal application/IP budgets apply; excess returns 429 with `Retry-After`. An opted-in `hooka.test` schema can reject the fixed synthetic payload with 400.

The UI shows pass/fail when the first attempt completes, updates for 30 seconds, and links to the persistent delivery log for queued tests or later retries. A failure may retry normally; a queued result is not a pass. No receiver settings are changed automatically, and no developer messages are sent. [Decision record](docs/adr/2026-09-22-auto-heal.md).
