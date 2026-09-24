# Grafana Cloud delivery alerts

The Hooka Relay dashboard already exports `hooka_delivery_attempts_total`, `hooka_circuit_transitions_total`, and `hooka_queue_depth` to the stack. Create Grafana-managed rules against the same Prometheus data source as `docs/grafana-dashboard.json`, in a dedicated `Hooka Relay` folder with a 1-minute evaluation group. Select the `Hooka Relay email` contact point directly on each rule. The email address must be a member of the Grafana organization.

| Rule | PromQL (instant query) | Condition | Pending |
| --- | --- | --- | --- |
| Delivery success rate | `100 * sum(increase(hooka_delivery_attempts_total{outcome="success"}[5m])) / clamp_min(sum(increase(hooka_delivery_attempts_total[5m])), 1)` | Below `90` | `5m` |
| Endpoint circuit opened | `sum by (endpoint_id) (increase(hooka_circuit_transitions_total{to="OPEN"}[2m]))` | Above `0` | None |
| Delivery queue growing | `max(hooka_queue_depth{queue="delivery-attempt-queue"})` | Above `100` | `5m` |

Use **No data: Normal** for low-volume periods and **Execution error: Error** so telemetry failures remain visible. The success rule intentionally treats a window with no attempts as no data. The circuit rule retains `endpoint_id`, which is an opaque ID and lets the operator identify the affected endpoint. Queue depth is the ready delivery queue only; it excludes unacknowledged jobs and retry TTL queues. Test each rule with a known synthetic event/metric before claiming the notification path works, and test the email contact point from Grafana's contact-point page.

These thresholds are initial operator defaults, not an SLA: 90% success sustained for 5 minutes catches broad receiver trouble without paging on a single retry; circuit-open should be immediate because the worker already requires five consecutive failures; 100 ready messages sustained for 5 minutes indicates workers may be falling behind at the current scale. Revisit them after observing normal traffic, especially if volume increases.
