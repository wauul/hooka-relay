# Hooka Relay API

POST /api/v1/events accepts Authorization: Bearer API_KEY (or X-API-Key). JSON fields are type (event type string), payload (JSON), and optional idempotencyKey. Successful admission returns HTTP 202 and the event. An already accepted idempotency key returns the original event. Limits: 256 KiB request body, JSON depth 32, and the configured per-application and per-IP budgets. See README.md for full examples and response errors.

GET /api/v1/me validates an API key and identifies its application. Keys are stored as SHA-256 digests and shown once at creation or rotation. Previous keys remain accepted until their configured grace expiry.

Dashboard application, endpoint and workspace APIs require a logged-in session and server-side workspace permissions. Event schemas use GET/PUT/DELETE /api/applications/:id/schemas. PUT takes eventType and schema; DELETE takes eventType. Schemas validate payload only for the exact registered type. Unsupported costly JSON Schema keywords are rejected.

PATCH /api/endpoints/:id/retry-policy takes retryPolicy: STANDARD, AGGRESSIVE or RELAXED. Endpoint pause/resume requires ADMIN or OWNER. Explicitly paused endpoints receive no delivery intent for new incoming events.

POST /api/support-chat takes question (1–500 characters) and optional history (at most three objects with question and answer). It is limited per user and IP, independently of event ingestion. Answers discuss only Hooka Relay, grounded in repository documentation. Off-topic questions receive a fixed decline. Missing evidence returns an explanation rather than an unsupported answer. HTTP 429 means a quota was exceeded; HTTP 503 means support is temporarily unavailable. GET /api/support-chat/stats requires an explicitly allowlisted platform administrator, not merely a workspace admin.

## Inbound webhook sources

Dashboard session routes: `GET/POST /api/applications/:id/sources` lists or creates sources; `GET/PATCH/DELETE /api/sources/:id` inspects or changes one; `POST /api/sources/:id/simulate` queues an explicitly simulated test delivery. Creation and changes require workspace ADMIN or OWNER. Source creation returns a unique ingestion URL. `PATCH` accepts `name`, `provider` during setup, `setupStep`, `providerSecret`, `verificationToken`, `destinationUrl`, `status`, and, for CUSTOM, `manualConfig`. `POST /api/sources/:id/github-registration` creates a GitHub repository webhook with a one-time fine-grained token. The destination must pass the existing public HTTPS SSRF validator; secrets are encrypted and never returned.

Public `POST /api/inbound/:ingestionToken` accepts a provider-signed JSON webhook, or Twilio/Slack URL-encoded form data, without a Hooka Relay API key. The token is unguessable but does not replace signature verification. Failed signatures return a generic 401; the source dashboard records a bounded failure reason. Bodies are capped at 256 KiB; JSON nesting at 32. IP and application event quotas apply. A verified request returns 202 with the Hooka Relay event ID. Slack URL-verification requests return the signed challenge.

Verified inbound events are stored as normal `Event` rows linked to the source, then target its dedicated `Endpoint` through the existing `Delivery` and `DeliveryAttempt` outbox/worker. Their payload is `{ provider, sourceId, providerEventId, data }`. Provider IDs from signed bodies are used for idempotency; otherwise a raw-body SHA-256 hash is used. The worker revalidates destination DNS at delivery time and applies the normal retry/circuit rules. Simulation uses the same path but does not check a provider signature.
