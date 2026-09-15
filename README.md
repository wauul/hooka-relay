# Hooka Relay

[![CI](https://github.com/wauul/hooka-relay/workflows/CI/badge.svg)](https://github.com/wauul/hooka-relay/actions/workflows/ci.yml)

[Live app](https://hooka-relay.vercel.app) · [API docs](https://hooka-relay.vercel.app/docs) · [Worker dashboard](https://railway.com/project/6a81016b-7716-4f67-807b-f0abf0a3987b/service/fbb521bc-0649-4a45-839e-15cbc60353a9) · [Live verification results](VERIFICATION.md)

[Hooka CLI](https://github.com/wauul/hooka-cli) is the standalone terminal companion: send events, list/register endpoints, tail attempts and replay deliveries. Install with `npm install -g hooka-relay-cli`, then run `hooka login` with your Application API key.

### CLI API

Application-key authentication (`Authorization: Bearer <key>` or `X-API-Key`) is supported by these routes in addition to event ingestion. Every resource lookup is scoped to that one Application, including resources owned by the same user in a different Application. Dashboard session routes remain unchanged.

| Method | Route | Response |
| --- | --- | --- |
| GET | `/api/v1/me` | `{ application: { id, name, createdAt } }` |
| GET | `/api/v1/endpoints` | `{ endpoints }` with 24-hour `successRate` (null without attempts) |
| POST | `/api/v1/endpoints` | `{ endpoint }` with signing secret; accepts `{ url, eventTypes }` |
| GET | `/api/v1/attempts?endpoint=ID&after=CURSOR` | `{ attempts, nextCursor, hasMore }`; optional filters, 100 per page |
| GET | `/api/v1/events/ID?generation=N` | `{ event, generation, deliveries }` with attempt counts and last results |
| POST | `/api/v1/events/ID/replay` | `{ eventId, generation, queued }`; 202 after durable outbox commit |

Read responses never expose endpoint secrets or application API keys, and use `Cache-Control: no-store`. Attempts omit webhook request/response bodies and headers. The first attempt page contains the most recent 100 entries in chronological order; pass the opaque cursor for subsequent pages. This polling feed is a developer convenience, not a lossless audit stream: a late database transaction can commit behind the cursor. The CLI drains full pages before sleeping; a future SSE feed could improve latency and reconnect semantics.

A webhook delivery service built with Next.js 14 App Router, React, Tailwind CSS, NextAuth Credentials, Prisma/Postgres, RabbitMQ and a separate Node.js worker. AI failure diagnosis uses Groq's `openai/gpt-oss-20b` (override with GROQ_MODEL). The requested `llama-3.1-8b-instant` was retired from Groq's shared API on August 16, 2026 and returns model_not_found.

## Run locally

Use Node.js 22 (the CI and Docker version) and pnpm 10.30.3 (`corepack enable`).

```sh
pnpm install
cp .env.example .env
# Set DATABASE_URL, RABBITMQ_URL, GROQ_API_KEY, NEXTAUTH_URL and NEXTAUTH_SECRET.
# Generate a secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
pnpm db:migrate
pnpm dev
# Separate terminal:
pnpm worker
```

The web app uses `http://localhost:3000`; the worker health endpoint uses port 8080 (override with PORT). Public webhook destinations must be HTTPS; built-in receivers should be tested on the deployed HTTPS web app. Prisma uses its JavaScript engine with the Postgres driver adapter for portability, including Windows ARM64.

## Architecture and guarantees

The API transaction stores an Event and a Delivery row for every matching endpoint before returning 202. Delivery rows form a durable outbox. The API attempts confirmed publishing, and the worker drains unpublished rows every five seconds. A broker outage does not lose accepted events. The worker also recovers overdue jobs, including classic queue dead-letter loss. Delivery resumes when the database, broker and worker are available; free-tier limits can pause service.

Endpoint leases serialize HTTP requests across worker replicas and enforce a single HALF_OPEN probe. Every queue message identifies a delivery and attempt number, so stale duplicates are ignored. A crash after a receiver processes an HTTP request but before the database records success can cause a duplicate. This is **at-least-once**, never exactly-once. Delivery state is tracked independently for each endpoint and each manual replay generation.

## API

Create an account (password minimum 12 characters), an Application, and an Endpoint in the dashboard. Copy your application's key.

```sh
export RELAY_URL=https://your-app.vercel.app
export API_KEY=hr_live_your_application_key
curl -X POST "$RELAY_URL/api/v1/events" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"order.shipped","idempotencyKey":"order-1042-shipped","payload":{"orderId":"ord_1042"}}'
```

202 returns the stored event. Payload limit: 256 KB. `X-API-Key` is also accepted. An omitted idempotency key generates a UUID. A supplied key is unique **within the Application**, including concurrent submissions. Reusing it returns the original event without new deliveries, even if the submitted payload differs. Event types match exact strings or `*`.

Session-authenticated dashboard routes enforce ownership:

| Route | Purpose |
| --- | --- |
| GET/POST /api/applications | List/create applications |
| GET/POST /api/applications/:id | Details/regenerate key |
| GET/POST /api/applications/:id/endpoints | List/register endpoints |
| POST /api/applications/:id/events | Send dashboard test event |
| GET /api/endpoints/:id/attempts | Last 100 attempts and 24-hour success rate |
| GET /api/endpoints/:id/events/:eventId | Request/response details and runs |
| POST /api/events/:id/replay | New delivery run for each original destination |
| GET/POST /api/fake-receiver/:mode | Public test receiver |

Register with `{"url":"https://example.com/hook","eventTypes":["order.shipped"]}` or `{"mode":"flaky","eventTypes":["*"]}`. Key regeneration invalidates the previous key immediately.

## Signature verification and receiver deduplication

The body is the JSON payload, with `X-Webhook-Signature: sha256=<hex HMAC>`, `X-Idempotency-Key`, `X-Webhook-Event`, and `X-Webhook-Endpoint` headers. Each endpoint has its own secret.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
export function verify(rawBody, signature, secret) {
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'));
  const actual = Buffer.from(signature || '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

Verify the raw bytes before JSON parsing. Reject invalid signatures. Store the idempotency key atomically with the receiver's business operation, scoped appropriately for the sending application/endpoint. On a duplicate, return 2xx without repeating side effects. Manual replay keeps the original key intentionally.

To independently calculate a signature and send a signed request:

```sh
export ENDPOINT_SECRET=your_endpoint_secret
printf '%s' '{"orderId":"ord_1042"}' > payload.json
SIGNATURE=$(node -e "const fs=require('fs'),c=require('crypto');process.stdout.write('sha256='+c.createHmac('sha256',process.env.ENDPOINT_SECRET).update(fs.readFileSync('payload.json')).digest('hex'))")
curl https://your-receiver.example/webhook \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Signature: $SIGNATURE" \
  -H 'X-Idempotency-Key: order-1042-shipped' \
  --data-binary @payload.json
```

## Retries: standard TTL + DLX

`lib/queue/topology.ts` automatically declares two durable direct exchanges (`webhook-relay`, `webhook-relay-retry`) and six durable queues. The real `delivery-attempt-queue` binds to **both** exchanges with `deliver`.

Messages published to the default exchange with a delay queue's name wait for its TTL, then RabbitMQ dead-letters them to `webhook-relay-retry` with `deliver`; the real queue receives them and the worker consumes them. No worker consumes a delay queue. No paid delayed-message plugin or manual broker configuration is needed.

| Failed attempt | Delay queue | Delay |
| --- | --- | --- |
| 1 | retry-delay-30s | 30 seconds |
| 2 | retry-delay-2m | 2 minutes |
| 3 | retry-delay-5m | 5 minutes |
| 4 | retry-delay-15m | 15 minutes |
| 5 | DEAD_LETTERED | No further retry |
| Reserved | retry-delay-30m | 30 minutes |

Five **total attempts** permits four retries. All five requested delay queues are declared, but the 30-minute queue is unused under this limit. Each HTTP request has an absolute 10-second deadline. Responses are stored up to 16 KB (truncation is identified); headers, timing, errors, and exact request bytes are recorded. All non-2xx responses are failures. The final record is DEAD_LETTERED, retaining timeout/connection error details separately.

## Circuit breaker

`lib/circuitBreaker.ts` contains pure transitions, covered by tests:

- **CLOSED:** Deliver normally. Five consecutive HTTP failures across the endpoint open the circuit. Any success resets the counter.
- **OPEN:** Skip HTTP calls and log SKIPPED_CIRCUIT_OPEN. Skips do not consume the five-attempt budget. Pending deliveries are deferred until recovery.
- **HALF_OPEN:** After ten minutes, one leased request tests recovery. Success closes the circuit; failure opens it and restarts the timer. Expired leases allow recovery after worker crashes.

## Demo

Register a one-click built-in receiver from the endpoint form. `succeed` returns 200, `fail` returns 500, `hang` exceeds the ten-second worker deadline (the route itself terminates after 14 seconds), and `flaky` fails its first two calls per endpoint/idempotency key, then succeeds. Flaky counters live in Postgres, not server memory, so serverless restarts do not reset them.

Send one flaky event and watch attempts 1 and 2 fail, followed by success after the 30-second and 2-minute retry queues. Send five different events to a fail endpoint to see the circuit open quickly, then a sixth to see a skipped request. The event inspector supports replay and shows each run's state.

After three consecutive failures, the worker sends recent response snippets to Groq for a validated JSON diagnosis. Do not include sensitive information in receiver error bodies. AI output is advisory. Groq failures do not stop delivery; diagnosis is rate-limited to once per minute per endpoint.

## Deployment

Web: Vercel Hobby. Worker: Railway Free/Trial with `Dockerfile.worker`. Set `RAILWAY_DOCKERFILE_PATH=Dockerfile.worker` on the worker service; the Docker CMD starts the compiled `node dist/worker/index.js`. New Railway services no longer accept legacy `railway.json` configuration, so do not rely on that file for startup. Database: Neon Free. Broker: CloudAMQP Little Lemur. AI: Groq Free. No payment information is needed for this setup, but quotas apply. Railway trial credits expire and the ongoing free allowance is limited; it does not guarantee a permanently running worker. Render does not offer a free background-worker instance.

Set the five `.env.example` variables on Vercel. On Railway set DATABASE_URL, RABBITMQ_URL, GROQ_API_KEY and NEXTAUTH_URL; NEXTAUTH_SECRET is not required by the worker. Use the production HTTPS origin for NEXTAUTH_URL. Run `pnpm db:migrate` before deployment. Never commit `.env` files. `pnpm build`, `pnpm test`, and `pnpm typecheck` provide local validation. Worker logs list all declared queues at startup.

Next.js 14.2.35 follows the requested stack, but Next.js 14 is outside the current supported LTS lines. Plan an upgrade before broader production use. This developer/demo service also needs deployment-level abuse controls and data retention policies for an unrestricted public launch. Endpoint requests block private/reserved IPs, pin DNS results, and never follow redirects.

## Running tests locally

Use Node.js 22 and `npm ci` for the same locked dependencies as CI. The pnpm lock remains available for the existing Vercel deployment.

```sh
npm ci
npm run test:unit       # isolated, no Docker or external credentials
npm test                # unit + integration
npm run test:watch
npm run test:coverage    # text summary and coverage/index.html
```

**Integration tests require Docker Desktop running with Linux containers**, or an equivalent Docker daemon. GitHub Actions uses Ubuntu's preinstalled Docker. Testcontainers creates a fresh PostgreSQL 18 container, applies Prisma migrations, injects its generated connection string, and stops it in global teardown. Each test deletes its own rows. Tests never use your `.env` database or hosted service secrets; unavailable Docker fails the integration suite instead of falling back to a live database.

Automated tests cover circuit-breaker boundaries and recovery, HMAC verification (empty, large and Unicode payloads), mocked idempotency, queue declarations/routing/publisher confirms, and the real event API against disposable Postgres. API tests also cover concurrent duplicate requests, application isolation, endpoint matching, invalid requests and the durable outbox during broker failure. Only RabbitMQ publishing is mocked in integration tests.

The suite has 76 unit tests and 14 integration tests. Combined coverage reached 100% statements, branches, functions and lines for the six scoped modules. Coverage measures six reliability/API modules explicitly listed in `vitest.config.ts`; it is not whole-application or UI coverage. CI enforces 90% statements, lines and functions, and 85% branches, and uploads HTML/LCOV reports. Full broker delivery, real TTL retry timing, worker recovery and browser flows remain manual checks documented in [VERIFICATION.md](VERIFICATION.md).

The CI workflow runs on pushes and pull requests to `master` (the default branch) and `main`. It installs with `npm ci`, typechecks, runs both test suites and coverage, builds Next.js, builds the worker image and checks its runtime contents. There is no existing lint script, so CI skips interactive lint setup and runs the strict TypeScript check instead.

## Worker Docker image

Only the always-on worker is containerized: Vercel already deploys the Next.js app. The multistage Node.js 22 slim image compiles TypeScript and ships a separate locked production dependency set, including the generated Prisma client. It runs as the non-root `node` user, without Next.js, TypeScript or test tools. `Dockerfile.worker` mirrors `Dockerfile` for the existing Railway service; CI checks they stay identical.

```sh
docker build -t hooka-relay-worker .
docker run --rm --name hooka-relay-worker -p 8080:8080 \
  -e DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require" \
  -e RABBITMQ_URL="amqps://USER:PASSWORD@HOST/VHOST" \
  -e GROQ_API_KEY="YOUR_GROQ_KEY" \
  -e NEXTAUTH_URL="https://hooka-relay.vercel.app" \
  hooka-relay-worker
```

Use real connection values in your local environment; do not commit them. Alternatively use `docker run --rm -p 8080:8080 --env-file .env hooka-relay-worker` after configuring `.env`. Apply schema migrations with `npm run db:migrate` before starting the worker. The image does not run migrations automatically. Check readiness at `http://localhost:8080/health`; a reachable database and broker are required. Groq provides optional failure diagnosis.


