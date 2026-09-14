import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { db } from "../lib/db";
import { channel, closeQueue } from "../lib/queue/client";
import { DELAYS, QUEUE } from "../lib/queue/topology";
import { beforeAttempt, afterAttempt } from "../lib/circuitBreaker";
import { signature } from "../lib/security";
import { deliver } from "../lib/deliver";
import { flushDelivery } from "../lib/events";
import { diagnose } from "../lib/diagnosis";
let stopping = false,
  ready = false;
async function processJob(job: { id: string; attemptNumber: number }) {
  const delivery = await db.delivery.findUnique({
    where: { id: job.id },
    include: { event: true },
  });
  if (
    !delivery ||
    delivery.status !== "PENDING" ||
    delivery.attemptNumber !== job.attemptNumber
  )
    return;
  if (delivery.dueAt.getTime() > Date.now() + 1000) return;
  const token = randomUUID();
  // Atomic endpoint lease serializes failures and enforces a single recovery probe.
  const locked = await db.endpoint.updateMany({
    where: {
      id: delivery.endpointId,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseUntil: new Date(Date.now() + 60_000), leaseToken: token },
  });
  if (!locked.count) return; // outbox watchdog recovers this acknowledged wakeup.
  try {
    const fresh = await db.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    if (fresh.status !== "PENDING" || fresh.attemptNumber !== job.attemptNumber)
      return;
    let endpoint = await db.endpoint.findUniqueOrThrow({
      where: { id: delivery.endpointId },
    });
    // A crashed HALF_OPEN probe is retried after its endpoint lease expires.
    const gate = beforeAttempt(
      endpoint.circuitState === "HALF_OPEN"
        ? { ...endpoint, circuitState: "OPEN" }
        : endpoint,
    );
    if (!gate.allowed) {
      await db.$transaction([
        db.deliveryAttempt.create({
          data: {
            eventId: delivery.eventId,
            endpointId: endpoint.id,
            deliveryId: delivery.id,
            attemptNumber: delivery.attemptNumber,
            status: "SKIPPED_CIRCUIT_OPEN",
            error: "skipped_circuit_open",
          },
        }),
        db.delivery.update({
          where: { id: delivery.id },
          data: {
            dueAt: new Date(
              Math.max(
                Date.now() + 30_000,
                (endpoint.circuitOpenedAt?.getTime() || Date.now()) + 600_000,
              ),
            ),
            publishedAt: new Date(),
            delayQueue: null,
          },
        }),
      ]);
      return; // Skips do not spend any of the five HTTP attempts.
    }
    if (gate.state.circuitState !== endpoint.circuitState)
      endpoint = await db.endpoint.update({
        where: { id: endpoint.id },
        data: { circuitState: gate.state.circuitState },
      });
    const raw = JSON.stringify(delivery.event.payload);
    const headers = {
      "Content-Type": "application/json",
      "X-Webhook-Signature": signature(raw, endpoint.secret),
      "X-Idempotency-Key": delivery.event.idempotencyKey,
      "X-Webhook-Event": delivery.event.type,
      "X-Webhook-Endpoint": endpoint.id,
    };
    const result = await deliver(endpoint.url, raw, headers);
    const success =
      result.code !== null && result.code >= 200 && result.code < 300;
    const dead = !success && delivery.attemptNumber >= 5;
    const next = afterAttempt(gate.state, success);
    const delay = DELAYS[delivery.attemptNumber - 1];
    await db.$transaction(async (tx) => {
      const owned = await tx.endpoint.updateMany({
        where: { id: endpoint.id, leaseToken: token },
        data: next,
      });
      if (!owned.count) throw new Error("Endpoint lease expired");
      await tx.deliveryAttempt.create({
        data: {
          eventId: delivery.eventId,
          endpointId: endpoint.id,
          deliveryId: delivery.id,
          attemptNumber: delivery.attemptNumber,
          status: success
            ? "SUCCESS"
            : dead
              ? "DEAD_LETTERED"
              : result.error === "timeout"
                ? "TIMEOUT"
                : "FAILED",
          httpStatusCode: result.code,
          responseBody: result.body,
          error: result.error,
          durationMs: result.duration,
          requestBody: raw,
          requestHeaders: headers,
          responseHeaders: result.headers,
        },
      });
      await tx.delivery.update({
        where: { id: delivery.id },
        data:
          success || dead
            ? { status: success ? "DELIVERED" : "DEAD_LETTERED" }
            : {
                attemptNumber: { increment: 1 },
                dueAt: new Date(Date.now() + delay.ms),
                delayQueue: delay.name,
                publishedAt: null,
              },
      });
    });
    console.log(
      JSON.stringify({
        deliveryId: delivery.id,
        attempt: delivery.attemptNumber,
        status: success ? "DELIVERED" : dead ? "DEAD_LETTERED" : "RETRY",
        circuit: next.circuitState,
      }),
    );
    if (!success && !dead) await flushDelivery(delivery.id);
    if (next.consecutiveFailures >= 3)
      await diagnose(endpoint.id).catch(() =>
        console.warn("AI diagnosis unavailable; delivery processing continues"),
      );
  } finally {
    await db.endpoint.updateMany({
      where: { id: delivery.endpointId, leaseToken: token },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
}
async function drain() {
  // Recover jobs lost between DB commit and broker confirm, or during classic
  // queue dead-lettering. Old duplicate wakeups are harmless under the lease.
  const overdue = await db.delivery.findMany({
    where: {
      status: "PENDING",
      publishedAt: { not: null },
      dueAt: { lt: new Date(Date.now() - 20_000) },
    },
    take: 50,
  });
  for (const d of overdue)
    await db.delivery.updateMany({
      where: {
        id: d.id,
        status: "PENDING",
        attemptNumber: d.attemptNumber,
        publishedAt: d.publishedAt,
      },
      data: { publishedAt: null, delayQueue: null },
    });
  const pending = await db.delivery.findMany({
    where: { status: "PENDING", publishedAt: null },
    take: 50,
  });
  for (const d of pending) await flushDelivery(d.id);
}
const server = createServer((_req, res) => {
  res.writeHead(ready ? 200 : 503);
  res.end(ready ? "worker ready" : "worker reconnecting");
});
server.listen(Number(process.env.PORT || 8080));
async function main() {
  while (!stopping) {
    try {
      const ch = await channel();
      await ch.prefetch(4);
      console.log(
        "Topology ready: webhook-relay, webhook-relay-retry, delivery-attempt-queue, " +
          DELAYS.map((d) => d.name).join(", "),
      );
      ready = true;
      const closed = new Promise<void>((resolve) => ch.once("close", resolve));
      await ch.consume(QUEUE, async (msg) => {
        if (!msg) return;
        try {
          const job = JSON.parse(msg.content.toString());
          if (
            typeof job.id !== "string" ||
            !Number.isInteger(job.attemptNumber)
          ) {
            ch.nack(msg, false, false);
            return;
          }
          await processJob(job);
          ch.ack(msg);
        } catch {
          console.error(
            "Delivery processing interrupted; durable outbox will recover",
          );
          try {
            ch.ack(msg);
          } catch {}
        }
      });
      let draining = false;
      const timer = setInterval(() => {
        if (draining) return;
        draining = true;
        drain()
          .catch(() => console.error("Outbox temporarily unavailable"))
          .finally(() => {
            draining = false;
          });
      }, 5000);
      await drain().catch(() =>
        console.error("Initial outbox drain unavailable; retrying on interval"),
      );
      await closed;
      clearInterval(timer);
      ready = false;
    } catch {
      ready = false;
      console.error("Worker connection unavailable; retrying in 5s");
    }
    if (!stopping) await new Promise((r) => setTimeout(r, 5000));
  }
}
process.on("SIGTERM", async () => {
  stopping = true;
  ready = false;
  await closeQueue();
  server.close();
  await db.$disconnect();
  process.exit(0);
});
main().catch(() => process.exit(1));
