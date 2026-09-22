# Security hardening status

Phase 1 was deployed and verified on 2026-09-21. Phase 2 begins separately with the customer portal. The controls and their limits are documented below; this is not a guarantee against every security issue.

## SSRF: outbound endpoints

`validateOutboundUrl` (also exported as `resolveEndpoint` for existing callers) rejects internal hostnames before DNS, credentials in URLs, reserved/private IPv4 and IPv6 DNS answers, empty answers, and URLs longer than 2048 characters. The existing stronger policy remains: HTTPS on port 443 only. Registration uses the same validator as delivery. Endpoint URL updates are not currently exposed.

The worker already resolves immediately before each HTTP attempt and pins that address to the TLS connection while retaining hostname certificate verification. Redirects are returned as failures, never followed. This prevents an attacker registering a public hostname and later changing its DNS to metadata/internal services, or redirecting to them. Mixed public/private answers fail closed.

Verify: registration at `https://169.254.169.254/`, `https://localhost/`, `https://[::1]/`, `https://printer.local/` must return 400. HTTPS public destinations pass. HTTP remains disallowed. Unit tests cover reserved ranges, mixed DNS, DNS failure, consecutive changed answers, transport pinning and redirects.

## Secrets at rest and disclosure

Current and previous API-key columns contain versioned SHA-256 digests. Incoming keys are hashed for lookup; knowing a stored digest does not authenticate. Rotation keeps the previous digest and its original grace semantics. Creation and rotation responses alone disclose the new plaintext with Cache-Control: no-store; GET views never return it. The UI keeps it only in component memory until dismissed/navigation, with no local storage or URL transport. Existing integrations retain their original credentials after migration.

Endpoint signing secrets use AES-256-GCM with random 96-bit nonces, authentication tags, and application-bound associated data. Database-only disclosure no longer yields signing credentials; modification or copying ciphertext between applications fails authentication. The worker decrypts only for signing, and the authorized admin detail view decrypts for receiver setup. Member detail/list routes no longer expose signing secrets, preventing a read-only teammate from forging webhooks. Plaintext values fail closed after rollout. Losing the encryption key makes ciphertext unrecoverable; protect it separately from database backups.

### Required offline migration and release procedure

Production migration completed on 2026-09-21: five applications and ten endpoints were transformed atomically. An encrypted snapshot was taken first. Every pre-migration user, workspace, membership, invite, application, endpoint, event, delivery and attempt ID was verified to remain present. All migrated key digests and decrypted signing secrets match their original values. The procedure below is retained for future installations.

1. Generate 32 random bytes as 64 hexadecimal characters; securely back up the value. Set the same `ENDPOINT_SECRET_ENCRYPTION_KEY` on the web app, worker, and migration process. Never commit it or print it in logs.
2. Test the release and `scripts/migrate-secrets.ts` on a disposable database seeded with legacy current/previous keys and endpoint secrets. CI tests original-key authentication, grace expiry, receiver signature compatibility with decrypted secrets, idempotency, and complete rollback with a wrong encryption key.
3. Update external receivers (including any separate CLI receiver implementation) for the new timestamp signature format. Arrange a maintenance window; stop web writes and the worker, preserving queued work. Take a protected database backup before migration.
4. Apply the additive Prisma IP-counter migration with `pnpm db:migrate`. Run `CONFIRM_OFFLINE_SECRET_MIGRATION=yes pnpm exec tsx scripts/migrate-secrets.ts` with migration credentials and the encryption key. On PowerShell set the environment variable separately. The script takes table write locks, transforms records in one transaction, authenticates every encrypted value, and logs only counts. A second run is a verified no-op. Existing IDs, memberships, grace dates, events and outbox work stay intact. No rows are deleted.
5. Start the updated web/worker together and verify an existing application's original API key, delivery, rotation/grace, and receiver verification. Do not start old binaries against migrated data. On failure, keep maintenance active and repair forward; any backup restoration requires an explicit data-loss review, never an automatic destructive rollback.

## Event body limits

Both public ingestion and dashboard test events read at most 256 KiB from the request stream, cancel on overflow (413), and reject structural JSON nesting deeper than 32 (400) before JSON.parse. Content-Length is an early rejection optimization only; lying or absent headers cannot bypass the counted-byte limit. Quoted/escaped brackets do not increase nesting. This prevents memory exhaustion from buffering unlimited bodies and deeply nested JSON parser/serializer attacks.

Existing limits remain: event types 120 characters with a safe character allowlist, idempotency keys 200, endpoint URLs 2000 at registration, subscriptions 50, application names 80, workspace names 100. Event payload limits also apply to dashboard submission.

## Layered rate limits

A Postgres atomic counter now runs before API-key lookup on public events. Default: 1000 requests per minute per IP. Login POSTs, signup, and invite acceptance share a separate 20/minute per-IP counter. Existing per-application rolling-window admission remains unchanged (100/minute by default). Responses include 429, JSON error and Retry-After: 60 for IP limits. Fixed IP windows permit a boundary burst; they are not a DDoS service.

Configure `EVENTS_IP_LIMIT_PER_MINUTE` and `AUTH_IP_LIMIT_PER_MINUTE`. Vercel's platform-controlled x-vercel-forwarded-for header is used only when VERCEL=1. Arbitrary X-Forwarded-For is not trusted. Missing/invalid addresses and self-hosted environments share an unidentified bucket, failing conservatively rather than accepting spoofed identities. Self-hosting requires a trusted ingress adaptation before public use. Raw IPs are not stored; counter keys contain SHA-256 digests. The worker deletes expired counters in its existing maintenance loop.

Verify: exceed the configured IP limit using missing/invalid API keys; requests must become 429 despite never authenticating. Parallel requests must not exceed the quota. Tests cover independent addresses, auth/event scopes, and signup enforcement.

NextAuth still handles credentials POSTs itself, including its built-in double-submit CSRF validation; the wrapper only adds a rate gate. Dashboard mutations retain same-origin checks.

## Replay protection

Outgoing signatures now use `t=UNIX_SECONDS,v1=HEX`, authenticating `timestamp + "." + exactBody`. Each attempt gets a fresh timestamp. Receiver verification rejects malformed signatures, tampered timestamps, and times more than 300 seconds in the past or future, using constant-time digest comparison. Captured requests can no longer be replayed indefinitely; receivers must still atomically deduplicate X-Idempotency-Key to prevent duplicate processing within the tolerance window.

Verify: an unchanged signed body succeeds within the window, fails at 301 seconds, and fails if either timestamp or body changes. Tests cover both clock directions and the exact boundary. README and /docs contain receiver examples. **Wire-format change:** receivers must be updated before the worker rollout; old body-only signatures are intentionally rejected. The updated worker and web app are deployed. All registered destinations were built-in test receivers; the separate CLI has no signature verifier.

## Browser and dependency controls

Middleware supplies a fresh per-response nonce CSP (no production unsafe-eval or script unsafe-inline), frame-ancestors none, object-src none, base-uri self, form-action self, X-Frame-Options DENY, nosniff, same-origin referrer policy and production HSTS. Inline styles remain allowed because the existing UI uses them. Root layout renders per request so nonce-bearing HTML is not statically cached. These controls mitigate injected script execution, clickjacking, MIME confusion, referrer leakage and protocol downgrades. Nonces follow the [Next.js CSP guidance](https://nextjs.org/docs/app/guides/content-security-policy).

NextAuth is patched to 4.24.15 (malformed bearer denial-of-service and provider/email validation advisories). PostCSS 8.5.28 prevents source-map file disclosure; Effect 3.22.2 addresses asynchronous context contamination; DeepmergeTS 8.0.0 addresses recursive-graph stack exhaustion. Overrides keep the existing Next.js/Prisma architecture. Both lockfiles were validated by the passing CI/builds before deployment.

CI runs `npm audit --audit-level=high`, including development dependencies. Dependabot checks npm and GitHub Actions weekly. Dependabot vulnerability alerts and automated security updates were enabled through the GitHub API (both returned 204). No manual GitHub settings step is needed.

## Database least privilege

The original `neondb_owner` runtime had CREATEROLE, CREATEDB, BYPASSRLS, schema CREATE and table ownership, allowing a compromised application to destroy or alter its schema. Both production services now use a separate `hooka_runtime` login: NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS, with no object ownership. SQL provisioning required no manual Neon dashboard changes.

The role has CONNECT, public-schema USAGE, and SELECT/INSERT/UPDATE/DELETE on application tables only. It cannot CREATE database/schema objects, TRUNCATE application tables, or access `_prisma_migrations`. Owner credentials remain separate for migrations. Future migrations must explicitly grant runtime DML on new application tables; do not grant blanket ownership or schema CREATE. If a future table uses sequences, grant only the necessary USAGE/SELECT on those sequences.

Verification used privilege inspection rather than destructive trial operations, then successful live reads/writes and worker delivery using the restricted credentials. Historical Vercel deployment URLs redirect to Vercel authentication; they are not public alternate versions of the API.

## Production verification

- CI: 237 tests (188 unit, 49 Testcontainers integration), enforced coverage, npm audit, lint, TypeScript, Next.js build and non-root worker image smoke checks passed.
- Existing account browser/API login, workspace access and original pre-migration API-key authentication passed.
- Existing endpoint delivery succeeded; the timestamped signature was independently verified with the pre-migration signing secret.
- Live metadata URL registration returned 400; oversize payload returned 413; excessive nesting returned 400.
- Rendered HTML used the CSP nonce from its response header. Security headers and missing-CSRF login rejection passed.
- Public IP quota returned 429 before authentication (only the test caller's identified counter was temporarily brought to its threshold, then restored). Authentication throttling returned 429 without submitting passwords.
- A dedicated verification application confirmed old/new keys both authenticate during rotation grace, with only their digests stored. Grace expiry is covered by integration tests.
- Vercel web deployment: `dpl_DWhHy9VHPLRqcFgaXKauuNnUhebv`; Railway worker: `1defb3ab-3c08-4f91-a2ba-bd0c5c6ef133`.

Keep the encryption key backed up in a password manager or other protected location independent of the database. Never deploy pre-migration binaries against the migrated database. Cloudflare is optional and has not been configured; application rate limits do not provide volumetric DDoS protection.


## Support assistant abuse controls

Support is grounded only in explicitly ingested repository documentation, never tenant records. A malformed/off-topic classification stops before embedding/retrieval/generation; the generation prompt separately constrains scope and evidence. User content is rendered as text, never HTML. Shared Postgres quotas cover IPs, authenticated users and a global daily budget, with atomic rollback on rejected admissions. This limits concurrent and distributed inference abuse. Inputs, histories, model output tokens and provider timeouts are bounded; failures do not automatically retry. Global statistics require an explicit operator allowlist. Unit spies and API integration tests prove the rejected-question short circuit, cache behavior, length limits, quotas and stats authorization. LLM scope decisions remain probabilistic; this is not a claim that prompt injection is impossible.

## Endpoint-bound signing secrets

The protocol extension uses `enc:v2:k1:...` AES-256-GCM ciphertext. Associated data includes the application ID, endpoint ID, secret version and encryption-key ID. Swapping two ciphertexts within the same application now fails authentication. `ENDPOINT_SECRET_KEY_ID` defaults to `k1`; its key is `ENDPOINT_SECRET_ENCRYPTION_KEY_K1` or the existing `ENDPOINT_SECRET_ENCRYPTION_KEY`. Future key IDs require their matching `ENDPOINT_SECRET_ENCRYPTION_KEY_K<n>`; retain old key material while any ciphertext references it. Portal-token encryption is unchanged.

For an existing installation: back up the database securely, apply the additive SQL migration, deploy the reader-compatible web and worker release, then run `npm run db:migrate-endpoint-secrets` with the owner database URL and existing encryption key. The script locks endpoint writes, verifies every plaintext round trip, updates ciphertext/version atomically, and is repeatable. It never changes endpoint IDs, key bytes, or wire formats. Version-zero rows remain readable during rollout; migrated rows reject application-only ciphertext. After migration, rolling back to an older binary requires restoring compatible ciphertext first; do not deploy an old reader against v2 rows. Grant the runtime role SELECT/INSERT on the new AuditLog table (no schema ownership).

Standard Webhooks signs the stable event ID as well as timestamp and body. This prevents replay with an attacker-selected deduplication ID within the timestamp window. Existing legacy endpoints remain opt-in for compatibility and retain that limitation until migrated. Receivers must atomically deduplicate the verified `webhook-id`. Automated tests use the independent `standardwebhooks` reference package, validate both grace-period signatures, expiry, altered IDs/bodies/timestamps, endpoint ciphertext swaps, concurrent rotation, and transactional migration rollback.

## Lifecycle extension boundaries

Payload transforms execute in QuickJS WebAssembly, never Node eval/vm. No host functions are exposed. CPU, heap, stack, code/output length and JSON-depth limits prevent runaway scripts from accessing server credentials or exhausting unbounded resources. Custom headers cannot override signing, identity, routing or connection headers; CR/LF injection is rejected. Header values use endpoint-bound encryption with a separate purpose context, and attempt logs redact them. Tests cover infinite loops, memory/output bombs, async/Node imports, tenant swapping and header injection.

Scoped keys cannot elevate from ingest/read to management; expiry and last-used tracking are server-side. Backlog anchors, cursors and endpoint filters stay application-scoped. Bulk recovery is a persistent, rate-controlled job using the original per-event lock; only the latest exhausted generation is eligible. Operational events are distinguished from user-submitted events, routed only to operational subscriptions, and cannot recursively emit further notifications. Notification email is mocked in CI.
