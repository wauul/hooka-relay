# Paid pilot operations

## Customer migration

New applications can select **Customer isolated**. Existing applications remain `LEGACY`; the migration does not assign old events or endpoints to a customer, and existing portal links keep their prior behavior. There is no in-place mode switch. To move an existing producer, create a new isolated application, create each customer with a stable external ID, register customer endpoints, issue their private portal links, and move the producer to the new application API key and `customerId` field. Confirm routing with one test event per customer, including wildcard subscriptions, before stopping the old application. Keep old history in the old application until its retention period ends. A customer portal link is a bearer credential: share it privately, rotate it after suspected exposure, and revoke it when access ends. Producer API keys are application-wide.

## Operating envelope and indicators

The default application admission limit remains 100 events/minute. The repeatable `capacity.test.ts` exercise sends 60 events with six concurrent clients against disposable migrated PostgreSQL, with one wildcard endpoint and a mocked unavailable RabbitMQ boundary. It measures accepted events/second, ingest p50/p95/p99, largest unpublished outbox backlog, and time to publish the backlog after the broker returns. This isolates admission and outbox recovery; it does **not** measure real receiver delivery, production Neon/Railway latency, multi-worker contention or uptime. Record the latest CI output before setting a paid pilot capacity commitment. Do not raise the limit from this small test alone.

Monitor `hooka_events_accepted_total` for accepted rate; `hooka_delivery_acceptance_to_first_attempt` for acceptance-to-first-attempt in seconds; `hooka_delivery_pending_age_seconds` and `hooka_delivery_pending_count` for backlog; `hooka_delivery_terminal_total` by outcome for final results; `hooka_worker_ready`, `hooka_queue_depth`, and `hooka_recovery_duration` for worker/broker/recovery health. `hooka_delivery_transport_errors_total` marks platform transport errors separately from `hooka_delivery_receiver_errors_total` for HTTP errors returned by customers. A metric absent because the exporter is down is **not** evidence of health.

Use the Grafana email contact point and a one-minute rule evaluation group. Start with these operator thresholds and tune against observed pilot traffic:

| Alert | Query/condition | Pending |
| --- | --- | --- |
| Worker stalled | `max(hooka_worker_ready) < 1` or no worker-ready series while traffic is expected | 2 minutes |
| Backlog age | `max(hooka_delivery_pending_age_seconds) > 300` | 5 minutes |
| Growing backlog | `sum(hooka_delivery_pending_count) > 100` and increasing | 5 minutes |
| Delivery transport errors | `sum(increase(hooka_delivery_transport_errors_total[5m])) > 5` | 5 minutes |
| Database/broker failure | `sum(increase(hooka_worker_database_errors_total[5m])) + sum(increase(hooka_worker_broker_connection_errors_total[5m])) > 0` | immediate |

Keep receiver HTTP failures on a separate dashboard/rule so a customer endpoint returning 500 does not look like a database outage. Alert rules and contact point must be installed and test notifications received before a paid pilot; this repository does not deploy Grafana Cloud rules.

## Incident response

1. Check web admission status, worker `/health`, Grafana worker readiness, queue depth, unpublished outbox count and oldest pending delivery age. Record the incident start in UTC and affected application IDs; keep payloads and secrets out of the incident note.
2. If the worker is stalled, restart the Railway worker and verify readiness and a controlled delivery. Avoid restarting the web app to cure a worker-only problem.
3. If RabbitMQ is unavailable, leave admission running only while the database and permitted backlog can absorb writes. Event and delivery intent commit before the 202 response. The worker's outbox sweep republishes rows with `publishedAt IS NULL` when RabbitMQ returns. Check broker connection and queue depth before restarting or scaling the worker.
4. Inspect oldest `PENDING` deliveries, the outbox, dead-lettered deliveries and active recovery jobs. If a receiver is failing, contact its owner and use endpoint pause/circuit controls. Once healthy, use replay or a bounded recovery job for terminal failures; pending deliveries already in the outbox do not need manual replay.
5. Measure time until the oldest pending age falls and the backlog drains; record actual recovery time. Tell affected customers when delays began, whether accepted events were retained, expected next update, and when verified delivery resumes. Do not promise an unmeasured SLA.

## History, usage and backups

Default `EVENT_RETENTION_DAYS=30`. The worker prunes at most 100 eligible event rows and 100 unlinked receipts per pass and records progress; pending delivery, routing, live forwarding and recovery work is held. A row exactly at the cutoff is retained until the next pass. After deletion, replay and idempotency lookup for that event are unavailable. Review counts and oldest rows before enabling cleanup on a historical production database. Monthly `WorkspaceUsageMonth` totals persist after detailed events are deleted: `acceptedEvents` is the manual billable unit (one successfully admitted, non-synthetic event), `destinationDeliveries` counts created delivery intents, and `retryAttempts` counts attempts after the first, excluding skipped open-circuit attempts. Replays do not add accepted events. Authorized operator emails in `OPERATOR_EMAILS` can export `/api/operator/usage?from=YYYY-MM&to=YYYY-MM&workspaceId=...&format=csv`. An agreed rate is applied outside Hooka; there is no price in the app.

Current protection: Neon point-in-time history was observed at six hours on 24 September 2026 but has **not** been drilled; confirm current plan and history in Neon before relying on it. CI performs a `pg_dump`/`psql` logical restore into disposable PostgreSQL on every integration run, checking representative application, event and attempt rows. This validates the software procedure, not production backup scheduling. Before a paid pilot, arrange a daily encrypted logical backup in storage outside Neon, limit access to operators, retain the database encryption key separately in a controlled secret store with documented key IDs, and run a non-production restore drill. Record backup UTC time, object location, checksum, encryption key ID, retention, restore duration, and verification query results. Do not put plaintext dumps or keys in the repository. Follow [the restore runbook](disaster-recovery.md) for the exact disposable and Neon steps.

## Rollout review gate

1. Review migration `202609240005_pilot_customers_usage`: additive nullable customer foreign keys, new mode defaulting to `LEGACY`, customer portal tokens and durable usage totals. It marks historical synthetic/operational events nonbillable, backfills retained event/delivery/retry counts and installs insert triggers under a writer lock. The migration scans existing history and temporarily blocks event/delivery writes; estimate its duration on a production-sized clone and schedule an appropriate window.
2. Apply migration to a disposable branch; run integration, retention and restore tests, then inspect legacy apps and reconcile a sample month of usage counts. Set `OPERATOR_EMAILS` only for vetted operators.
3. Deploy web and worker built from the same commit after the migration succeeds. Verify a legacy application, a new two-customer app, cross-customer denial, metering, worker readiness, broker failure recovery and Grafana alert notifications.
4. Only then enable scheduled cleanup after comparing counts of eligible versus held old rows and ensuring a reviewed backup/restore path. Never manually delete production historical rows to make rollout easier.

Production migration, deployment, cleanup and alert installation require a separate review. No production action is performed by this branch.
