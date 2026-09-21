import type { Channel } from "amqplib";
export const EXCHANGE = "webhook-relay";
export const RETRY_EXCHANGE = "webhook-relay-retry";
export const QUEUE = "delivery-attempt-queue";
export const DELAYS = [
  { name: "retry-delay-30s", ms: 30_000 },
  { name: "retry-delay-2m", ms: 120_000 },
  { name: "retry-delay-5m", ms: 300_000 },
  { name: "retry-delay-15m", ms: 900_000 },
  { name: "retry-delay-30m", ms: 1_800_000 },
] as const;
// CloudAMQP shared free plans do not support the delayed-message-exchange plugin.
// Standard TTL + DLX works without plugins or manual console configuration:
// default exchange -> named delay queue -> wait for queue TTL -> automatic
// dead-letter to webhook-relay-retry (key: deliver) -> real queue -> worker.
// The real queue binds to BOTH direct exchanges. Exchanges do not magically
// forward to one another: the second binding is essential to avoid lost retries.
// Every queue is durable; publishers use persistent messages + confirms.
// Classic-queue dead-lettering can lose messages during broker failures. The DB
// outbox watchdog recovers overdue uncompleted jobs, preserving at-least-once.
export async function declareTopology(ch: Channel) {
  await ch.assertExchange(EXCHANGE, "direct", { durable: true });
  await ch.assertExchange(RETRY_EXCHANGE, "direct", { durable: true });
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.bindQueue(QUEUE, EXCHANGE, "deliver");
  await ch.bindQueue(QUEUE, RETRY_EXCHANGE, "deliver");
  for (const delay of DELAYS)
    await ch.assertQueue(delay.name, {
      durable: true,
      arguments: {
        "x-message-ttl": delay.ms,
        "x-dead-letter-exchange": RETRY_EXCHANGE,
        "x-dead-letter-routing-key": "deliver",
      },
    });
  // No consumer is registered on a delay queue. Endpoint retry policies choose
  // among these same fixed TTL queues; existing queue declarations never change.
}
