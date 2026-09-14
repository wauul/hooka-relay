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
