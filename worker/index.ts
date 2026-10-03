import { drainNotices } from "../lib/operational-events";
import { drainRecovery } from "../lib/recovery";
import { stopObservability } from "../lib/observability-runtime";
import { isolatedOperation, reportUnexpected } from "../lib/sentry-reporting";
import { traced } from "../lib/observability";
import { captureCheckIn } from "@sentry/core";
import { queueDepth, count, addCount, gauge } from "../lib/observability";
import { createServer } from "node:http";
import { db } from "../lib/db";
import { channel, closeQueue } from "../lib/queue/client";
import { DELAYS, QUEUE } from "../lib/queue/topology";
import { encryptionKey } from "../lib/secrets";
import { flushDelivery } from "../lib/events";
import { advanceRoutingExecution } from "../lib/routing";
import { createLiveRelay } from "./live-relay";
import { processJob } from "./process-job";
import { pruneEventHistory } from "../lib/retention";
import { maintenanceLoop } from "./maintenance-loop";
import { WORKER_WAKE_EXCHANGE } from "../lib/worker-wakeup";
encryptionKey(); // Refuse to advertise a ready worker without its required key.
let stopping = false,
  ready = false;
async function drain() {
  const routes = await db.routingExecution.findMany({ where: { status: "RUNNING" }, select: { id: true }, take: 50 });
  for (const route of routes) await advanceRoutingExecution(route.id);
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
  const oldest = await db.delivery.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  gauge("hooka.delivery.pending_age_seconds", oldest ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000) : 0);
  const activePending = await db.delivery.count({ where: { status: "PENDING", endpoint: { status: "ACTIVE" } } });
  gauge("hooka.delivery.pending_count", await db.delivery.count({ where: { status: "PENDING" } }));
  // A route blocked entirely on paused deliveries must not hold Neon awake.
  // Routes whose current group has finished (or had no active destination)
  // still need a quick pass to advance the next group or finish the execution.
  const runnableRoutes = await db.routingExecution.count({ where: {
    status: "RUNNING",
    groups: { none: { status: "RUNNING", destinations: { some: { delivery: { status: "PENDING" } } } } },
  } });
  return activePending > 0 || runnableRoutes > 0;
}
let nextCleanupAt = 0;
async function cleanup() {
    // On a failure, do not let active deliveries turn cleanup into a retry storm.
    nextCleanupAt = Date.now() + 30 * 60_000;
    await db.inboundLiveSession.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - 60000) } } });
    await db.endpoint.updateMany({ where: { previousSecretExpiresAt: { lte: new Date() } }, data: { previousSecret: null, previousSecretVersion: null, previousSecretExpiresAt: null } });
    await db.application.updateMany({ where: { previousApiKeyExpiresAt: { lte: new Date() } }, data: { previousApiKey: null, previousApiKeyExpiresAt: null } });
    await db.$executeRaw`DELETE FROM "IpRateBucket" WHERE "expiresAt" < NOW()`;
    await db.eventAdmission.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 60000) } } });
    const result = await pruneEventHistory();
    addCount("hooka.retention.events_deleted", result.events);
    addCount("hooka.retention.receipts_deleted", result.receipts);
    // Keep draining full batches; otherwise check retention at most hourly.
    const full = result.events >= 100 || result.receipts >= 100;
    nextCleanupAt = full ? 0 : Date.now() + 60 * 60_000;
    return full;
}
let nextCheckInAt = 0;
async function maintain() {
  // Idle work shares one 30 minute sweep. Active work never floods Cron quotas.
  const monitor = process.env.SENTRY_MAINTENANCE_MONITOR && Date.now() >= nextCheckInAt ? process.env.SENTRY_MAINTENANCE_MONITOR : undefined;
  if (monitor) nextCheckInAt = Date.now() + 30 * 60_000;
  const checkInId = (() => {
    try { return monitor ? captureCheckIn({ monitorSlug: monitor, status: "in_progress" }, { schedule: { type: "interval", value: 30, unit: "minute" }, checkinMargin: 10, maxRuntime: 2, failureIssueThreshold: 2, recoveryThreshold: 1 }) : undefined; }
    catch { return undefined; }
  })();
  // Cleanup shares the worker's wake window, rather than waking Neon by itself.
  const results = await Promise.allSettled([
    isolatedOperation("worker.drain", { service: "worker" }, () => traced("worker.drain", {}, drain)),
    isolatedOperation("worker.recovery", { service: "worker" }, () => traced("worker.recovery", {}, drainRecovery)),
    isolatedOperation("worker.notices", { service: "worker" }, () => traced("worker.notices", {}, drainNotices)),
    ...(Date.now() >= nextCleanupAt ? [isolatedOperation("worker.retention", { service: "worker" }, () => traced("worker.retention", {}, cleanup))] : []),
  ]);
  if (results.some(result => result.status === "rejected")) {
    count("hooka.worker.database_errors");
    console.error("Lifecycle maintenance pending; durable work will be retried");
  }
  if (monitor && checkInId) {
    try { captureCheckIn({ checkInId, monitorSlug: monitor, status: results.some(result => result.status === "rejected") ? "error" : "ok" }); }
    catch { /* Check-in transport must not affect durable maintenance. */ }
  }
  return results.some(result => result.status === "fulfilled" && result.value);
}
let maintenance: ReturnType<typeof maintenanceLoop> | undefined;
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
      gauge("hooka.worker.ready", 1);
      const closed = new Promise<void>((resolve) => ch.once("close", resolve));
      maintenance = maintenanceLoop(maintain, error => {
        reportUnexpected(error, "worker.maintenance", { service: "worker" }, true);
        count("hooka.worker.database_errors");
        console.error("Database maintenance unavailable; retrying on the idle safety sweep");
      });
      await ch.assertExchange(WORKER_WAKE_EXCHANGE, "fanout", { durable: true });
      const wakeQueue = (await ch.assertQueue("", { durable: false, exclusive: true, autoDelete: true })).queue;
      await ch.bindQueue(wakeQueue, WORKER_WAKE_EXCHANGE, "");
      await ch.consume(wakeQueue, msg => { if (msg) { maintenance?.wake(); ch.ack(msg); } });
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
          maintenance?.wake();
          ch.ack(msg);
        } catch (error) {
          reportUnexpected(error, "worker.consume", { service: "worker" }, true);
          maintenance?.wake();
          count("hooka.worker.delivery_system_errors");
          console.error(
            "Delivery processing interrupted; durable outbox will recover",
          );
          try {
            ch.ack(msg);
          } catch (error) { reportUnexpected(error, "broker.channel", { service: "worker" }, true); }
        }
      });
      let inspecting = false;
      const telemetryTimer = setInterval(() => {
        if (inspecting || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
        inspecting = true;
        ch.checkQueue(QUEUE).then(q => queueDepth(q.messageCount)).catch(error => reportUnexpected(error, "broker.inspect", { service: "worker" }, true)).finally(() => { inspecting = false; });
      }, 60000);
      await closed;
      liveRelay.detach();
      await maintenance.stop();
      clearInterval(telemetryTimer);
      ready = false;
      gauge("hooka.worker.ready", 0);
    } catch (error) {
      reportUnexpected(error, "broker.connect", { service: "worker" }, true);
      await maintenance?.stop();
      ready = false;
      gauge("hooka.worker.ready", 0);
      count("hooka.worker.broker_connection_errors");
      console.error("Worker connection unavailable; retrying in 5s");
    }
    if (!stopping) await new Promise((r) => setTimeout(r, 5000));
  }
}
async function shutdown(exitCode: number, error?: unknown) {
  if (stopping) return;
  if (error !== undefined) reportUnexpected(error, "worker.fatal", { service: "worker" });
  stopping = true;
  ready = false;
  const deadline = setTimeout(() => process.exit(exitCode), 10_000);
  try {
    await maintenance?.stop();
    liveRelay.close();
    await closeQueue();
    server.close();
    await db.$disconnect();
  } catch (error) { reportUnexpected(error, "worker.shutdown", { service: "worker" }); }
  finally { await stopObservability().catch(() => {}); clearTimeout(deadline); process.exit(exitCode); }
}
process.on("SIGTERM", () => { void shutdown(0); });
process.on("SIGINT", () => { void shutdown(0); });
process.on("uncaughtException", error => { void shutdown(1, error); });
process.on("unhandledRejection", error => { void shutdown(1, error); });
main().catch(error => { void shutdown(1, error); });

