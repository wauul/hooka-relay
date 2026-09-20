# Security hardening status

Phase 1 is **in progress**, not complete. Phase 2 has not started. This document distinguishes implemented controls from remaining work; it is not a claim that the whole application is production-hardened.

## SSRF: outbound endpoints

`validateOutboundUrl` (also exported as `resolveEndpoint` for existing callers) rejects internal hostnames before DNS, credentials in URLs, reserved/private IPv4 and IPv6 DNS answers, empty answers, and URLs longer than 2048 characters. The existing stronger policy remains: HTTPS on port 443 only. Registration uses the same validator as delivery. Endpoint URL updates are not currently exposed.

The worker already resolves immediately before each HTTP attempt and pins that address to the TLS connection while retaining hostname certificate verification. Redirects are returned as failures, never followed. This prevents an attacker registering a public hostname and later changing its DNS to metadata/internal services, or redirecting to them. Mixed public/private answers fail closed.

Verify: registration at `https://169.254.169.254/`, `https://localhost/`, `https://[::1]/`, `https://printer.local/` must return 400. HTTPS public destinations pass. HTTP remains disallowed. Unit tests cover reserved ranges, mixed DNS, DNS failure, consecutive changed answers, transport pinning and redirects.

## Secrets at rest and disclosure

Current and previous API-key columns contain versioned SHA-256 digests. Incoming keys are hashed for lookup; knowing a stored digest does not authenticate. Rotation keeps the previous digest and its original grace semantics. Creation and rotation responses alone disclose the new plaintext with Cache-Control: no-store; GET views never return it. The UI keeps it only in component memory until dismissed/navigation, with no local storage or URL transport. Existing integrations retain their original credentials after migration.

Endpoint signing secrets use AES-256-GCM with random 96-bit nonces, authentication tags, and application-bound associated data. Database-only disclosure no longer yields signing credentials; modification or copying ciphertext between applications fails authentication. The worker decrypts only for signing, and the authorized admin detail view decrypts for receiver setup. Member detail/list routes no longer expose signing secrets, preventing a read-only teammate from forging webhooks. Plaintext values fail closed after rollout. Losing the encryption key makes ciphertext unrecoverable; protect it separately from database backups.

### Required offline migration and release procedure

This has **not run on production**. No hosted data or runtime environment has been changed by this branch.

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

Verify: an unchanged signed body succeeds within the window, fails at 301 seconds, and fails if either timestamp or body changes. Tests cover both clock directions and the exact boundary. README and /docs contain receiver examples. **Wire-format change:** receivers must be updated before the worker rollout; old body-only signatures are intentionally rejected. This branch has not been deployed.

## Browser and dependency controls

Middleware supplies a fresh per-response nonce CSP (no production unsafe-eval or script unsafe-inline), frame-ancestors none, object-src none, base-uri self, form-action self, X-Frame-Options DENY, nosniff, same-origin referrer policy and production HSTS. Inline styles remain allowed because the existing UI uses them. Root layout renders per request so nonce-bearing HTML is not statically cached. These controls mitigate injected script execution, clickjacking, MIME confusion, referrer leakage and protocol downgrades. Nonces follow the [Next.js CSP guidance](https://nextjs.org/docs/app/guides/content-security-policy).

NextAuth is patched to 4.24.15 (malformed bearer denial-of-service and provider/email validation advisories). PostCSS 8.5.28 prevents source-map file disclosure; Effect 3.22.2 addresses asynchronous context contamination; DeepmergeTS 8.0.0 addresses recursive-graph stack exhaustion. Overrides keep the existing Next.js/Prisma architecture. Both lockfiles must pass CI before deployment.

CI runs `npm audit --audit-level=high`, including development dependencies. Dependabot checks npm and GitHub Actions weekly. Repository owners should check Settings > Code security for Dependabot alerts and security updates; configuration alone does not prove those settings are enabled.

## Database least privilege: action required

Read-only production inspection on 2026-09-20 found `neondb_owner`, with CREATEROLE, CREATEDB, BYPASSRLS, public-schema CREATE permission and ownership of 12 public tables. **The runtime role can perform destructive schema operations. This has not been fixed.** No permissions were changed and no destructive verification was attempted.

Create a separate Neon runtime login with NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS, no object ownership, and no membership in owner/admin roles. Grant CONNECT to the application database, USAGE on public, SELECT/INSERT/UPDATE/DELETE only on application tables, and USAGE/SELECT on sequences if needed. Do not grant CREATE on schemas/database, TRUNCATE, ownership, or access to `_prisma_migrations`. Remove PUBLIC schema CREATE if present after reviewing other consumers. Set matching owner default privileges for future application tables. Use a separate owner connection only for migrations, never in the Vercel/Railway runtime. Replace DATABASE_URL on both runtimes after testing this role in staging. Neon role creation/privilege changes remain a manual owner step.

## Remaining Phase 1 work

- Provision the encryption key and verify the offline secret migration/live rollout.
- Verify deployed headers, CSRF, layered limits and existing delivery flows after the security release.
- Restricted database runtime role (manual owner action above).

No Phase 2 portal, schema registry, retry policies, public status or support chatbot has been implemented in this security checkpoint. Do not start Phase 2 until remaining Phase 1 work is complete and verified.
