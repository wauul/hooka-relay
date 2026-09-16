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
| `X-Webhook-Signature` | HMAC-SHA256 signature of the raw request body |
| `X-Idempotency-Key` | Producer-supplied key or generated UUID |
| `X-Webhook-Event` | Event type |
| `X-Webhook-Endpoint` | Endpoint ID |

Verify the signature against the endpoint secret before parsing or handling the payload. Store the idempotency key with the operation it triggers and return a 2xx response for a duplicate.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWebhook(rawBody, signature, secret) {
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  );
  const received = Buffer.from(signature ?? '');

  return received.length === expected.length &&
    timingSafeEqual(received, expected);
}
```

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
