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

Requests contain the event payload as JSON along with these headers:

| Header | Purpose |
| --- | --- |
| `X-Webhook-Signature` | `t=UNIX_SECONDS,v1=HEX`: HMAC-SHA256 of `timestamp + "." + raw body` |
| `X-Idempotency-Key` | Producer-supplied key or generated UUID |
| `X-Webhook-Event` | Event type |
| `X-Webhook-Endpoint` | Endpoint ID |

Verify the signature against the endpoint secret before parsing or handling the payload. Store the idempotency key with the operation it triggers and return a 2xx response for a duplicate.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(rawBody, signature, secret) {
  const parts = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(signature || '');
  if (!parts || Math.abs(Date.now() / 1000 - Number(parts[1])) > 300) return false;
  const expected = createHmac('sha256', secret)
    .update(parts[1] + '.').update(rawBody).digest();
  return timingSafeEqual(Buffer.from(parts[2], 'hex'), expected);
}
```

The receiver rejects timestamps more than five minutes in either direction; keep receiver clocks synchronized. Every retry receives a fresh signature. This changes the previous `sha256=...` wire format: update receivers before deploying the updated worker. Never accept the old body-only format as a fallback.

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

Phase 1 hardening is in progress. See [SECURITY.md](SECURITY.md) for implemented controls, attack scenarios, verification steps, the database role audit, and remaining work. Phase 2 product features are intentionally gated on completing and verifying Phase 1.


### Security release configuration

New settings: `ENDPOINT_SECRET_ENCRYPTION_KEY` (required, identical on web/worker; 32 random bytes encoded as hex), `EVENTS_IP_LIMIT_PER_MINUTE` (1000), and `AUTH_IP_LIMIT_PER_MINUTE` (20). API keys are shown only when created/rotated and stored as SHA-256 digests; signing secrets are encrypted. The previous API key remains valid during its configured grace period.

The production security migration was completed on 2026-09-21. Other existing installations must follow the offline credential migration and receiver signature update in [SECURITY.md](SECURITY.md) before upgrading. Request bodies over 256 KiB return 413; JSON depth over 32 returns 400. IP throttling runs before authentication and returns 429 with `Retry-After: 60` and `{ "error": "Too many requests. Try again shortly.", "retryAfter": 60 }`. The existing per-application admission limit is separate.

## Customer portal

Workspace admins can enable a private customer link from an application page. Visitors need no account: they can register public HTTPS endpoints, inspect their signing secrets and recent delivery results, pause/resume, and delete their own endpoints. Each visitor receives a separate HttpOnly browser credential; possessing the shared application link alone does not grant access to other visitors' or dashboard-created endpoints. Clearing cookies or changing browsers loses that visitor access; the workspace admin can still manage the endpoints.

Only share the link with people authorized to receive the application's matching events. Subscription filtering is by event type, not by a customer field inside the payload. Use separate applications when event data must be isolated between customers. Portal endpoint registration has the same SSRF protection, an 8 KiB request limit, maximum JSON depth 32, a separate `PORTAL_IP_LIMIT_PER_MINUTE` quota (30 by default), and caps of 10 endpoints per visitor / 50 portal endpoints per application. Pausing prevents new delivery work; resuming does not backfill missed events.

Portal tokens are stored as digests plus encrypted copies for authorized admin sharing. Portal and invitation pages omit analytics and send `Referrer-Policy: no-referrer`. API responses are not cacheable. Anonymous visitor credentials are not recoverable from the database.

The portal is the first Phase 2 feature. Configurable retry policies, public status, and the support chatbot are not implemented yet.

## Event payload schemas

Owners/admins can add, replace and remove schemas in an application's Event schemas panel (`GET/PUT/DELETE /api/applications/:id/schemas`). Members can view schemas. The request body for PUT is `{ "eventType": "order.shipped", "schema": { "type": "object", "properties": { "orderId": { "type": "string" } }, "required": ["orderId"] } }`; DELETE takes `eventType` only.

Ingestion and dashboard test events validate the payload with Ajv when that exact type has a schema. Other types pass through. Invalid payloads return 400 with `{ "error": "Payload does not match the event schema", "failures": [{ "path": "/orderId", "message": "must be string" }] }` and create no event or delivery intent. Validation stops at the first error to bound work. Previously accepted idempotency keys still return their original event regardless of later schema changes.

Schemas use a bounded draft-07 subset: types, object properties/required/additionalProperties, array items and bounds, string length, numeric bounds/multipleOf, enum/const, title/description. Regex, formats, references, combinators and uniqueItems are rejected to prevent expensive untrusted validation. Definitions are capped at 16 KiB, depth 12, 250 schema nodes, 100 enum options and 50 types per application. Payloads are never coerced or modified. These limits follow [Ajv's security considerations](https://ajv.js.org/security.html).
