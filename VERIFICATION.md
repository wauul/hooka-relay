# Live verification — 2026-09-14

Web: https://hooka-relay.vercel.app

GitHub: https://github.com/wauul/hooka-relay

Worker: https://railway.com/project/6a81016b-7716-4f67-807b-f0abf0a3987b/service/fbb521bc-0649-4a45-839e-15cbc60353a9

## Flaky receiver: real TTL + DLX delivery

Event: cmu16rc5m000004l9xyi3q5rj

| Attempt | HTTP | Recorded at (UTC) | Duration |
| --- | --- | --- | --- |
| 1 | 500 | 2026-09-14T11:55:02.413Z | 260 ms |
| 2 | 500 | 2026-09-14T11:55:34.382Z | 567 ms |
| 3 | 200 | 2026-09-14T11:57:36.262Z | 530 ms |

The endpoint finished CLOSED with zero consecutive failures. The 30-second and 2-minute delay queues were observed with messages and no consumers. The real delivery queue had one Railway worker consumer. All six queues and both exchanges were declared automatically on the initially empty CloudAMQP instance.

## Passed checks

- Signup (201), Credentials login, and session establishment.
- Application and endpoint creation through session-authenticated APIs.
- Two simultaneous API submissions with one producer idempotency key return the same event.
- A succeed receiver returns 200 and records DELIVERED.
- Hang receiver times out after 10018 ms.
- Five consecutive failures open the endpoint circuit; later jobs record SKIPPED_CIRCUIT_OPEN without HTTP.
- Stored request HMAC independently recomputed from raw bytes and endpoint secret; idempotency header matches original event.
- Replay creates a separate delivery generation and delivers successfully while preserving the event key.
- Anonymous access returns 401; a separate authenticated user receives 404 for another user's application, endpoint log, and replay.
- Groq returns a schema-validated diagnosis with cause, fix, and confidence.
- Browser login, dashboard navigation, live delivery log, and successful retry badge verified; no browser console errors observed.
- Seven unit tests pass: breaker threshold/reset/cooldown/probe behavior, TTL/DLX topology, SSRF address rejection, raw-body HMAC.
- TypeScript check and production build pass.
- Prisma migration 202609140001_init applied to live Neon.

## Compatibility and limits

Next.js 14.2.35 follows the requested version but is outside current supported LTS lines. Prisma uses its JavaScript engine; generated WASM is explicitly traced into Vercel functions. Railway worker uses the Dockerfile path environment variable because new services no longer accept legacy config-as-code. Groq retired llama-3.1-8b-instant; openai/gpt-oss-20b was verified on the free account. Five total attempts means four retry intervals; the fifth delay queue is reserved.

Free/trial quotas apply; continuous worker uptime is not guaranteed after credits are exhausted. Half-open cooldown transitions are unit-tested; the ten-minute recovery cycle was not waited through in the live run. Responses are intentionally truncated at 16 KB.


## Workspaces release — 2026-09-16

- Next.js 15.5.25 and React 19: production build, ESLint, TypeScript and worker build pass.
- CI run https://github.com/wauul/hooka-relay/actions/runs/35100703889: 131 unit tests, 38 Testcontainers integration tests, coverage gates and Docker runtime smoke checks pass.
- Testcontainers starts from the original schema with realistic existing records before applying the real migrations.
- Production migrations applied successfully with Prisma through Neon's direct endpoint. A private local snapshot was captured before migration. All 3 existing users, 4 applications, 9 endpoints, 21 events, 26 deliveries, 182 attempts and 5 flaky-receiver records were preserved. Every original application owner has OWNER membership in the corresponding workspace.
- The existing demo account signs in and sees its original applications after migration.
- Live Resend invitation was delivered, accepted after sign-in/registration, and created MEMBER membership. The sender is Hooka Relay <invites@waelfz.com>.
- Live MEMBER session can read the application and send test events; key rotation, endpoint pause and workspace rename return 403.
- Live rate test: 100 repeated valid requests admitted in the rolling window, then 429 with Retry-After; retries reuse an existing idempotency key so they do not create extra deliveries.
- Live key rotation: current and previous keys both authenticate during the 24-hour grace period; another rotation returns 409. Expiry boundaries are covered by unit and database integration tests.
- Live paused ingestion creates no delivery; resume does not backfill; explicit replay is delivered by the production worker with SUCCESS.
- Workspace management and accepted membership were inspected in the browser.
- The worker deployment for commit 43d2954 completed successfully. Durable outbox, endpoint leases, TTL+DLX topology and flaky counters retain their original implementation.

Local integration runs require Docker, which was unavailable on this workstation. The passing Testcontainers and Docker runs above occurred on GitHub Actions, not against the hosted database.
