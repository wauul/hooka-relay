# Hooka Relay troubleshooting

## Why is my endpoint circuit open?

Five consecutive failed attempts open the endpoint circuit for ten minutes. After the cooldown, one delivery may probe the receiver in HALF_OPEN state. A successful probe closes the circuit and resets the failure count; a failed probe opens it again. Check the receiver's availability, response code, TLS certificate and response time. The worker serializes endpoint access with a database lease.

## What does SKIPPED_CIRCUIT_OPEN mean?

The worker deliberately made no HTTP request because the endpoint circuit was open. It records the skip and reschedules according to the circuit cooldown. This differs from explicitly pausing an endpoint: incoming events matching a paused endpoint create no delivery intent for it.

## Why didn't my event retry immediately?

Retries wait in durable RabbitMQ TTL queues. STANDARD allows five total attempts with 30-second, 2-minute, 5-minute and 15-minute retry delays. AGGRESSIVE allows seven attempts with 30s, 30s, 30s, 2m, 2m and 5m delays. RELAXED allows four attempts with 5m, 15m and 30m delays. An open circuit can postpone delivery further. A policy change affects the next failed attempt; it does not move an already scheduled retry or reset the attempt number. Inspect delivery history for errors and dead-lettered attempts.

## Why did resuming an endpoint not deliver older events?

Pause is an explicit choice to stop creating delivery intents for new events. Resume only affects future event ingestion. Replay an older event explicitly if you want it delivered. Events are delivered at least once, so receivers must handle duplicate idempotency keys safely.

## How do I verify the HMAC signature?

New endpoints use Standard Webhooks. Verify webhook-id, webhook-timestamp and webhook-signature with the standardwebhooks reference library and the displayed whsec_ secret. It authenticates the stable Event ID, timestamp and exact raw request body, with a five-minute tolerance. Atomically deduplicate the verified webhook-id. Existing LEGACY endpoints retain X-Webhook-Signature (timestamp plus raw-body HMAC) until explicitly switched; do not trust their unsigned idempotency header for deduplication. During signing-secret rotation, both keys work for seven days by default. Legacy mode keeps the old primary signature during grace and places the new signature in X-Webhook-Signature-Current. Update the receiver before expiry. See README.md for the migration path. Never parse and reserialize JSON before verification or accept the former body-only format.

## Why can't I see my API key again?

Hooka Relay stores an API key digest, not its plaintext. Copy a new key when creating an application or rotating the key. During rotation the previous key continues working until the displayed grace-period expiry. Both keys share the application's ingestion rate limit. Rotating again replaces the previous-key slot.

## Why does endpoint registration reject my URL?

Destinations must be public HTTPS URLs on port 443. Localhost, internal names, private/reserved IPs and cloud metadata destinations are blocked. DNS is checked at registration and before every delivery attempt, and delivery uses the validated address. Redirects are not followed. This prevents the trusted worker from accessing internal services on a caller's behalf.

## What do 400, 401, 413 and 429 mean on event ingestion?

400 means invalid event fields, excessive JSON depth, or a payload failing an opted-in event schema. Schema failures include a path and message. 401 means the API key is missing, invalid or expired. 413 means the request exceeds 256 KiB. 429 means an IP or application rate limit was reached; wait for the Retry-After period before trying again. The default application budget is 100 requests per rolling minute. Unregistered event types are not schema-validated.

## Why can't a workspace member change settings?

MEMBER can view applications, endpoints and delivery history, and send test events. ADMIN and OWNER can manage applications, endpoints, keys and schemas. Only the OWNER can delete the workspace or transfer ownership. The owner must transfer ownership before leaving. These permissions are enforced by the server.

## What can a customer portal visitor access?

Each browser gets a separate private visitor credential. Visitors can manage only the endpoints they created through that application portal and see those endpoints' recent delivery results. Sharing the application portal URL does not share another visitor's endpoints. Clearing cookies loses visitor access; a workspace admin can still manage the endpoints. The portal is not a per-customer payload filter: use separate applications when customers must receive different private data.

## Does the public status page measure platform uptime?

No. It aggregates observed delivery attempts over the last 24 hours, excluding circuit-open skips. Receiver failures and deliberately failing test receivers count. A detected incident needs two consecutive completed five-minute windows, each with at least five attempts and success below 90%. Missing or low-volume windows break the sequence. No tenant identifiers, URLs or payloads are exposed.
