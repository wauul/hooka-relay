# Security hardening status

Phase 1 is **in progress**, not complete. Phase 2 has not started. This document distinguishes implemented controls from remaining work; it is not a claim that the whole application is production-hardened.

## SSRF: outbound endpoints

`validateOutboundUrl` (also exported as `resolveEndpoint` for existing callers) rejects internal hostnames before DNS, credentials in URLs, reserved/private IPv4 and IPv6 DNS answers, empty answers, and URLs longer than 2048 characters. The existing stronger policy remains: HTTPS on port 443 only. Registration uses the same validator as delivery. Endpoint URL updates are not currently exposed.

The worker already resolves immediately before each HTTP attempt and pins that address to the TLS connection while retaining hostname certificate verification. Redirects are returned as failures, never followed. This prevents an attacker registering a public hostname and later changing its DNS to metadata/internal services, or redirecting to them. Mixed public/private answers fail closed.

Verify: registration at `https://169.254.169.254/`, `https://localhost/`, `https://[::1]/`, `https://printer.local/` must return 400. HTTPS public destinations pass. HTTP remains disallowed. Unit tests cover reserved ranges, mixed DNS, DNS failure, consecutive changed answers, transport pinning and redirects.

## Event body limits

Both public ingestion and dashboard test events read at most 256 KiB from the request stream, cancel on overflow (413), and reject structural JSON nesting deeper than 32 (400) before JSON.parse. Content-Length is an early rejection optimization only; lying or absent headers cannot bypass the counted-byte limit. Quoted/escaped brackets do not increase nesting. This prevents memory exhaustion from buffering unlimited bodies and deeply nested JSON parser/serializer attacks.

Existing limits remain: event types 120 characters with a safe character allowlist, idempotency keys 200, endpoint URLs 2000 at registration, subscriptions 50, application names 80, workspace names 100. Event payload limits also apply to dashboard submission.

## Layered rate limits

A Postgres atomic counter now runs before API-key lookup on public events. Default: 1000 requests per minute per IP. Login POSTs, signup, and invite acceptance share a separate 20/minute per-IP counter. Existing per-application rolling-window admission remains unchanged (100/minute by default). Responses include 429, JSON error and Retry-After: 60 for IP limits. Fixed IP windows permit a boundary burst; they are not a DDoS service.

Configure `EVENTS_IP_LIMIT_PER_MINUTE` and `AUTH_IP_LIMIT_PER_MINUTE`. Vercel's platform-controlled x-vercel-forwarded-for header is used only when VERCEL=1. Arbitrary X-Forwarded-For is not trusted. Missing/invalid addresses and self-hosted environments share an unidentified bucket, failing conservatively rather than accepting spoofed identities. Self-hosting requires a trusted ingress adaptation before public use. Raw IPs are not stored; counter keys contain SHA-256 digests. The worker deletes expired counters in its existing maintenance loop.

Verify: exceed the configured IP limit using missing/invalid API keys; requests must become 429 despite never authenticating. Parallel requests must not exceed the quota. Tests cover independent addresses, auth/event scopes, and signup enforcement.

NextAuth still handles credentials POSTs itself, including its built-in double-submit CSRF validation; the wrapper only adds a rate gate. Dashboard mutations retain same-origin checks.

## Browser and dependency controls

Middleware supplies a fresh per-response nonce CSP (no production unsafe-eval or script unsafe-inline), frame-ancestors none, object-src none, base-uri self, form-action self, X-Frame-Options DENY, nosniff, same-origin referrer policy and production HSTS. Inline styles remain allowed because the existing UI uses them. Root layout renders per request so nonce-bearing HTML is not statically cached. These controls mitigate injected script execution, clickjacking, MIME confusion, referrer leakage and protocol downgrades. Nonces follow the [Next.js CSP guidance](https://nextjs.org/docs/app/guides/content-security-policy).

NextAuth is patched to 4.24.15 (malformed bearer denial-of-service and provider/email validation advisories). PostCSS 8.5.28 prevents source-map file disclosure; Effect 3.22.2 addresses asynchronous context contamination; DeepmergeTS 8.0.0 addresses recursive-graph stack exhaustion. Overrides keep the existing Next.js/Prisma architecture. Both lockfiles must pass CI before deployment.

CI runs `npm audit --audit-level=high`, including development dependencies. Dependabot checks npm and GitHub Actions weekly. Repository owners should check Settings > Code security for Dependabot alerts and security updates; configuration alone does not prove those settings are enabled.

## Database least privilege: action required

Read-only production inspection on 2026-09-20 found `neondb_owner`, with CREATEROLE, CREATEDB, BYPASSRLS, public-schema CREATE permission and ownership of 12 public tables. **The runtime role can perform destructive schema operations. This has not been fixed.** No permissions were changed and no destructive verification was attempted.

Create a separate Neon runtime login with NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS, no object ownership, and no membership in owner/admin roles. Grant CONNECT to the application database, USAGE on public, SELECT/INSERT/UPDATE/DELETE only on application tables, and USAGE/SELECT on sequences if needed. Do not grant CREATE on schemas/database, TRUNCATE, ownership, or access to `_prisma_migrations`. Remove PUBLIC schema CREATE if present after reviewing other consumers. Set matching owner default privileges for future application tables. Use a separate owner connection only for migrations, never in the Vercel/Railway runtime. Replace DATABASE_URL on both runtimes after testing this role in staging. Neon role creation/privilege changes remain a manual owner step.

## Remaining Phase 1 work

- SHA-256 API key migration and creation/rotation-only disclosure, preserving previous-key grace.
- AES-256-GCM signing-secret encryption, secure key provisioning and migration/live rollout verification.
- Timestamp-plus-body signatures and receiver tolerance-window verification/docs.
- Verify deployed headers, CSRF, layered limits and existing delivery flows after the security release.
- Restricted database runtime role (manual owner action above).

No Phase 2 portal, schema registry, retry policies, public status or support chatbot has been implemented in this security checkpoint. Do not start Phase 2 until remaining Phase 1 work is complete and verified.
