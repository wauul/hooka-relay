# 2026-09-22: Sandbox and endpoint configuration

## Context
Receivers need different schemas, headers and throughput limits without exposing the worker host or changing other endpoints.

## Decision
Use QuickJS WebAssembly with no host APIs and bounded resources. Sign transformed bytes; keep original events immutable. Encrypt header values under a separate endpoint-bound purpose and redact logs. Default environment metadata to production, with freeform labels.

## Consequences
Adds one free, portable dependency to web tooling and worker runtime. Transform failures consume the existing attempt budget. Throttling uses leases and outbox scheduling, so it favors safe spacing over exact dispatch times.
