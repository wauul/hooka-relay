# 2026-09-22: Producer idempotency and receiver identity

## Context
Producer retries must not create duplicate events. A captured webhook must not gain a new deduplication identity by changing an unsigned header.

## Decision
Preserve application-scoped producer key uniqueness and generated UUID fallback, with duplicate lookup before schema validation. Sign the stable server Event ID in Standard Webhooks construction.

## Consequences
Producer keys remain compatible; receiver deduplication uses the authenticated webhook-id. Replay creates a delivery generation, not a new event. Ordering across retries is not guaranteed.
