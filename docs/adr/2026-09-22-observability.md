# Durable trace context and bounded telemetry

## Context
An event can outlive the API invocation, RabbitMQ wakeup and worker process. Broker-only context would disappear when the durable outbox recovers a missed publication. Receiver URLs, secrets and payloads must not enter an observability service.

## Decision
Persist only a W3C traceparent on Event. Outbox publication and every retry attach to that original ingestion span; no message-body or TTL/DLX topology changes. Next.js request spans are exported with generic names and an attribute allowlist. Custom spans carry opaque event/delivery/endpoint IDs, never email, payload, URL, headers or exception text. Do not automatically instrument HTTP/SQL. OTLP/HTTP sends directly to Grafana Cloud without another service. Export is opt-in, bounded and best effort; sample traces at 10% using the trace ID consistently across services, independently of caller sampling flags. Metrics remain unsampled. Queue depth is inspected once a minute on the existing queue.

## Consequences
Outbox recovery and restarts preserve correlation. Older events have no context and start new traces. Export outages may lose telemetry but never fail a delivery or change retries. Serverless ingestion uses Next after() to flush before suspension; other Next request traces are best effort through the batch exporter. Metrics use bounded outcome/delay/state labels; circuit transitions additionally carry opaque endpoint IDs for troubleshooting. Grafana is an operator tool, not a tenant dashboard. Never grant customers access to the stack. No logs, payloads or receiver credentials are exported.
