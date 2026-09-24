import { drainNotices } from "../lib/operational-events";
import { drainRecovery } from "../lib/recovery";
import "dotenv/config";
import { startObservability, stopObservability } from "../lib/observability-runtime";
import { queueDepth } from "../lib/observability";
startObservability("worker");
import { createServer } from "node:http";
import { db } from "../lib/db";
import { channel, closeQueue } from "../lib/queue/client";
import { DELAYS, QUEUE } from "../lib/queue/topology";
import { encryptionKey } from "../lib/secrets";
import { flushDelivery } from "../lib/events";
import { advanceRoutingExecution } from "../lib/routing";
import { createLiveRelay } from "./live-relay";
import { processJob } from "./process-job";
encryptionKey(); // Refuse to advertise a ready worker without its required key.
let stopping = false,
  ready = false;
async function drain() {
  const routes = await db.routingExecution.findMany({ where: { status: "RUNNING" }, select: { id: true }, take: 50 });
  for (const route of routes) await advanceRoutingExecution(route.id);
  await db.inboundLiveSession.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - 60000) } } });
  await db.endpoint.updateMany({ where: { previousSecretExpiresAt: { lte: new Date() } }, data: { previousSecret: null, previousSecretVersion: null, previousSecretExpiresAt: null } });
  await db.application.updateMany({ where: { previousApiKeyExpiresAt: { lte: new Date() } }, data: { previousApiKey: null, previousApiKeyExpiresAt: null } });
  await db.$executeRaw`DELETE FROM "IpRateBucket" WHERE "expiresAt" < NOW()`;
    await db.eventAdmission.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 60000) } } });
  // Recover jobs lost between DB commit and broker confirm, or during classic
  // queue dead-lettering. Old duplicate wakeups are harmless under the lease.
  const overdue = await db.delivery.findMany({
    where: {
      status: "PENDING",
      endpoint: { status: "ACTIVE" },
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
    where: { status: "PENDING", publishedAt: null, endpoint: { status: "ACTIVE" } },
    take: 50,
  });
  for (const d of pending) await flushDelivery(d.id);
}
const server = createServer((_req, res) => {
  res.writeHead(ready ? 200 : 503);
  res.end(ready ? "worker ready" : "worker reconnecting");
});
const liveRelay = createLiveRelay(server);
server.listen(Number(process.env.PORT || 8080));
async function main() {
  while (!stopping) {
    try {
      const ch = await channel();
      await ch.prefetch(4);
      await liveRelay.attach(ch);
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
      let inspecting = false;
      const telemetryTimer = setInterval(() => {
        if (inspecting || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
        inspecting = true;
        ch.checkQueue(QUEUE).then(q => queueDepth(q.messageCount)).catch(() => {}).finally(() => { inspecting = false; });
      }, 60000);
      let maintaining = false;
      const maintenance = setInterval(() => {
        if (maintaining) return;
        maintaining = true;
        Promise.allSettled([drainRecovery(), drainNotices()]).then(results => { if (results.some(r => r.status === "rejected")) console.error("Lifecycle maintenance pending; delivery processing continues"); }).finally(() => { maintaining = false; });
      }, 5000);
      await drain().catch(() =>
        console.error("Initial outbox drain unavailable; retrying on interval"),
      );
      await closed;
      liveRelay.detach();
      clearInterval(timer);
      clearInterval(maintenance);
      clearInterval(telemetryTimer);
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
  await stopObservability();
  liveRelay.close();
  await closeQueue();
  server.close();
  await db.$disconnect();
  process.exit(0);
});
main().catch(() => process.exit(1));

