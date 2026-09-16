# Hooka Relay

[![CI](https://github.com/wauul/hooka-relay/workflows/CI/badge.svg)](https://github.com/wauul/hooka-relay/actions/workflows/ci.yml)

[Live app](https://hooka-relay.vercel.app) · [API docs](https://hooka-relay.vercel.app/docs) · [Live verification results](VERIFICATION.md)

[Hooka CLI](https://github.com/wauul/hooka-cli) is the standalone terminal companion: send events, list/register endpoints, tail attempts and replay deliveries. Install with `npm install -g hooka-relay-cli`, then run `hooka login` with your Application API key.

### CLI API

Application-key authentication (`Authorization: Bearer <key>` or `X-API-Key`) is supported by these routes in addition to event ingestion. Every resource lookup is scoped to that one Application, including resources owned by the same user in a different Application. Dashboard session routes use workspace membership and role checks.

| Method | Route | Response |
| --- | --- | --- |
| GET | `/api/v1/me` | `{ application: { id, name, createdAt } }` |
| GET | `/api/v1/endpoints` | `{ endpoints }` with 24-hour `successRate` (null without attempts) |
| POST | `/api/v1/endpoints` | `{ endpoint }` with signing secret; accepts `{ url, eventTypes }` |
| GET | `/api/v1/attempts?endpoint=ID&after=CURSOR` | `{ attempts, nextCursor, hasMore }`; optional filters, 100 per page |
| GET | `/api/v1/events/ID?generation=N` | `{ event, generation, deliveries }` with attempt counts and last results |
| POST | `/api/v1/events/ID/replay` | `{ eventId, generation, queued }`; 202 after durable outbox commit |

Read responses never expose endpoint secrets or application API keys, and use `Cache-Control: no-store`. Attempts omit webhook request/response bodies and headers. The first attempt page contains the most recent 100 entries in chronological order; pass the opaque cursor for subsequent pages. This polling feed is a developer convenience, not a lossless audit stream: a late database transaction can commit behind the cursor. The CLI drains full pages before sleeping; a future SSE feed could improve latency and reconnect semantics.

A webhook delivery service built with Next.js 15 App Router, React, Tailwind CSS, NextAuth Credentials, Prisma/Postgres, RabbitMQ and a separate Node.js worker. AI failure diagnosis uses Groq's `openai/gpt-oss-20b` (override with GROQ_MODEL). The requested `llama-3.1-8b-instant` was retired from Groq's shared API on August 16, 2026 and returns model_not_found.

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

Session-authenticated dashboard routes enforce workspace membership and roles:

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

Register with `{"url":"https://example.com/hook","eventTypes":["order.shipped"]}` or `{"mode":"flaky","eventTypes":["*"]}`. Key rotation retains the previous key for a configurable grace period (see below).

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

This developer/demo service also needs deployment-level abuse controls and data retention policies for an unrestricted public launch. Endpoint requests block private/reserved IPs, pin DNS results, and never follow redirects.

## Running tests locally

Use Node.js 22 and `npm ci` for the same locked dependencies as CI. The pnpm lock remains available for the existing Vercel deployment.

When changing dependencies with pnpm, also run `npx --yes npm@10.9.8 install --package-lock-only --ignore-scripts` and commit both lockfiles. This uses the npm version bundled with CI's Node 22 runtime. CI and Docker use `package-lock.json`; Vercel uses `pnpm-lock.yaml`.

```sh
npm ci
npm run test:unit       # isolated, no Docker or external credentials
npm test                # unit + integration
npm run test:watch
npm run test:coverage    # text summary and coverage/index.html
```

**Integration tests require Docker Desktop running with Linux containers**, or an equivalent Docker daemon. GitHub Actions uses Ubuntu's preinstalled Docker. Testcontainers creates a fresh PostgreSQL 18 container, applies Prisma migrations, injects its generated connection string, and stops it in global teardown. Each test deletes its own rows. Tests never use your `.env` database or hosted service secrets; unavailable Docker fails the integration suite instead of falling back to a live database.

Automated tests cover circuit-breaker boundaries and recovery, HMAC verification (empty, large and Unicode payloads), mocked idempotency, queue declarations/routing/publisher confirms, and the real event API against disposable Postgres. API tests also cover concurrent duplicate requests, application isolation, endpoint matching, invalid requests and the durable outbox during broker failure. Only RabbitMQ publishing is mocked in integration tests.

The suite has 131 unit tests and 38 integration tests. Combined scoped coverage reached 97.39% statements, 95.54% branches, 100% functions and 99.06% lines. Coverage includes the original reliability modules and the new workspace, permissions, key-rotation, rate-limit, endpoint-state and invitation-email modules; it is not whole-application or UI coverage. CI enforces 90% statements, lines and functions, and 85% branches, and uploads HTML/LCOV reports. Full broker delivery, real TTL retry timing, worker recovery and browser flows remain manual checks documented in [VERIFICATION.md](VERIFICATION.md).

The CI workflow runs on pushes and pull requests to `master` (the default branch) and `main`. It installs with `npm ci`, typechecks, runs both test suites and coverage, builds Next.js, builds the worker image and checks its runtime contents. CI runs ESLint and strict TypeScript checks as separate required steps.

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




## Workspaces and teams

Applications belong to workspaces. The sidebar switcher selects the workspace used by the dashboard; a user can belong to several workspaces. Workspace management is available at /workspaces. Session routes check membership and permissions on the server.

| Action | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| View applications, endpoints, logs and usage; send test events; replay | Yes | Yes | Yes |
| Rename workspace; create/delete applications and endpoints; pause/resume; rotate keys | Yes | Yes | No |
| Invite ADMIN/MEMBER; revoke invites; change other non-owner roles | Yes | Yes | No |
| Remove a MEMBER | Yes | Yes | No |
| Remove an ADMIN | Yes | No | No |
| Leave voluntarily | Transfer ownership first | Yes | Yes |
| Transfer ownership; delete workspace and its data | Yes | No | No |

There is exactly one owner, enforced by PostgreSQL constraints. Ownership transfers are transactional and demote the previous owner to ADMIN. Nobody can kick an owner. Deleting a workspace permanently deletes its applications, endpoints, events and delivery history; the UI requires confirmation. The legacy user ownership column is retained for audit, but access uses workspace membership exclusively.

The migration creates one personal workspace per existing user with applications, makes that user OWNER and reassigns all their applications without changing IDs, API keys, endpoint secrets or delivery data. A first workspace is created on demand for accounts without one. Testcontainers starts from the original schema with multiple users/applications, endpoints, events, attempts and flaky-receiver counters, then applies the actual migrations and checks preservation. Tests never fall back to a hosted database. Back up your database before deployment; coordinate the schema migration with the new web and worker releases because the old web version cannot create applications with the new required workspace field.

Invitations are emailed through Resend, expire after seven days, and grant only ADMIN or MEMBER. The recipient must sign in or register with the invited email, then accept at /invites/accept?token=.... Tokens are random 256-bit values. Revoked, expired and previously accepted invitations cannot restore a kicked or departed membership. A failed email send revokes its invitation and returns 503; retry from the UI after fixing email configuration. Pending invitations can be revoked by an admin.

| Method | Session API route | Purpose |
| --- | --- | --- |
| GET / POST | /api/workspaces | List memberships / create workspace |
| GET / PATCH / DELETE | /api/workspaces/:id | Details and members / rename / delete |
| GET / POST | /api/workspaces/:id/invites | Pending invitations / email invitation |
| DELETE | /api/workspaces/:id/invites/:inviteId | Revoke invitation |
| POST | /api/invites/:token/accept | Accept as the signed-in recipient |
| PATCH / DELETE | /api/workspaces/:id/members/:userId | Change role / remove member |
| POST | /api/workspaces/:id/leave | Leave workspace |
| POST | /api/workspaces/:id/transfer-ownership | Transfer to body userId |
| DELETE | /api/applications/:id | Delete application and child data |
| DELETE | /api/endpoints/:id | Delete endpoint and its delivery history |
| PATCH | /api/endpoints/:id/pause or /resume | Change explicit ingestion status |

POST /api/applications accepts an optional workspaceId; GET accepts ?workspaceId=.... The dashboard supplies X-Workspace-Id. Without a selection the oldest membership is used. Membership is always checked, including when a client supplies an ID. Application keys remain application-scoped administrative credentials for the existing CLI API; member-facing application responses omit them. Removing someone does not revoke credentials they previously copied; rotate keys after removing a former administrator when appropriate.

## Event ingestion rate limit

POST /api/v1/events admits at most 100 valid requests per rolling 60-second window per Application. Set EVENTS_RATE_LIMIT_PER_MINUTE to a positive integer to change it. Both current and previous keys share this budget, as do retries with an existing idempotency key. Invalid keys and malformed payloads do not consume it. PostgreSQL records admissions under an application-row lock, so the limit is shared across serverless instances without Redis. Old admission rows are pruned on requests and by the worker.

A rejected request returns HTTP 429, a Retry-After header in seconds, and JSON such as {"error":"Rate limit exceeded","retryAfter":42}. No event or delivery is inserted for that rejected request. Wait at least Retry-After seconds before retrying with the same idempotency key.

## API key rotation

Admins rotate keys using POST /api/applications/:id. The response includes currentApiKey and previousApiKeyExpiresAt. API_KEY_GRACE_HOURS defaults to 24 (positive hours, up to 8760). The previous key works strictly before its expiry in both event ingestion and CLI authentication. The dashboard displays its exact expiry. A second rotation during the active grace period returns 409, preserving the earlier promise rather than silently invalidating a third key. The worker clears expired previous keys; authentication rejects expired keys even if the worker is offline. Existing key values are retained by mapping currentApiKey to the original database column.

## Explicit endpoint pause

Endpoint status is ACTIVE or PAUSED, independently of CLOSED/OPEN/HALF_OPEN circuit state. When ingestion sees PAUSED it creates no delivery intent or skipped-attempt log for that endpoint. The event itself remains stored. Existing queued deliveries retain their original processing/retry behavior. Resume affects subsequent ingestions only and does not backfill events received while paused.

To deliberately replay a stored event to a resumed endpoint, use the endpoint page's event-ID replay form, or send {"endpointId":"ENDPOINT_ID"} to POST /api/events/:id/replay (session) or POST /api/v1/events/:id/replay (application key). The endpoint must be active, match the event type, and belong to the same application. Replay without endpointId preserves the existing original-destination behavior and idempotency key.

## Additional configuration and validation

| Variable | Default / purpose | Service |
| --- | --- | --- |
| EVENTS_RATE_LIMIT_PER_MINUTE | 100; positive integer | Web |
| API_KEY_GRACE_HOURS | 24; positive hours | Web |
| RESEND_API_KEY | Required to send invitations; never expose to browsers | Web |
| RESEND_FROM | Verified sender, e.g. Hooka Relay <invites@waelfz.com> | Web |
| NEXTAUTH_URL | Existing setting; public origin used in invite links | Web |

Resend's free-tier email and verified-domain quotas apply. No new paid infrastructure is required. The verified sender must match a domain configured in your Resend account; a subdomain needs its own verification and an available domain slot. Application and worker continue using the existing PostgreSQL and RabbitMQ services.

The web application uses Next.js 15.5.25 and React 19. Run npm run lint, npm run typecheck, npm run test:unit, npm run test:integration, npm run test:coverage, npm run build and npm run build:worker. CI also builds the worker Docker image and smoke-tests its contents. ESLint uses the matching Next.js core-web-vitals configuration; strict TypeScript remains a separate check. Invite tests mock the email boundary and never send real email. Both npm and pnpm lockfiles are maintained.

For Neon deployments, use the direct (non-pooler) connection URL when running Prisma schema migrations; retain the pooled URL for the web app and worker. Override DATABASE_URL only for the migration command.

Verification on 2026-09-16: all 169 tests and the full CI build passed. Production migration preserved all existing rows and owner access. Live checks covered existing-account login, invitation delivery and acceptance, MEMBER restrictions, key grace, rolling rate limits, pause/resume and explicit replay through the worker. See [VERIFICATION.md](VERIFICATION.md).

### Guided invitations

Invitation links choose sign-up for a new account or sign-in for an existing account. The invited email is read-only. Authentication does not join the workspace: the next screen shows the workspace and role, with explicit Accept and Decline actions. Declining records DECLINED without adding membership; an admin must issue a fresh invitation to join later. Expired and revoked links show a clear unavailable state. POST /api/invites/:token/decline requires the invited account, just like acceptance.

### Display names

Accounts use an editable display name, initially the email prefix (up to 40 characters). Change it under Profile & display name in the sidebar. Team lists show names; email remains the sign-in and invitation identifier. Display names are not unique usernames. Existing accounts are backfilled, and only untouched auto-migrated personal workspace names are shortened. Custom workspace names are preserved.
