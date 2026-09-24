import { endpointAvailability, outboundCustomHeaders, redactedDeliveryHeaders } from "../lib/endpoint-options";
import { transformPayload } from "../lib/payload-transform";
import { operationalEvent } from "../lib/operational-events";
import { traced, deliveryMetric, count } from "../lib/observability";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { retryPlan } from "../lib/retry-policy";
import { beforeAttempt, afterAttempt } from "../lib/circuitBreaker";
import { webhookHeaders } from "../lib/webhook-signing";
import { deliver } from "../lib/deliver";
import { flushDelivery } from "../lib/events";
import { originalReplayPayload } from "../lib/inbound-replay-payload";
import { advanceRoutingExecution } from "../lib/routing";
import { diagnose } from "../lib/diagnosis";
import { clearFailureStreak, incrementFailureStreak, redisConfigured } from "../lib/redis-counters";
export async function processJob(job: { id: string; attemptNumber: number }) {
  const delivery = await db.delivery.findUnique({
    where: { id: job.id },
    include: { event: { include: { inboundReceipt: true } } },
  });
  if (
    !delivery ||
    delivery.status !== "PENDING" ||
    delivery.attemptNumber !== job.attemptNumber
  )
    return;
  if (delivery.dueAt.getTime() > Date.now() + 1000) return;
  return traced("delivery.attempt", { "hooka.event.id": delivery.eventId, "hooka.delivery.id": delivery.id, "hooka.endpoint.id": delivery.endpointId, "hooka.attempt": job.attemptNumber }, async span => {
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
    const availability = endpointAvailability(endpoint);
    if (!availability.allowed) {
      span.setAttribute("hooka.outcome", endpoint.status === "PAUSED" ? "paused" : "throttled");
      await db.delivery.update({ where: { id: delivery.id }, data: { dueAt: availability.dueAt, publishedAt: new Date(), delayQueue: null } });
      return; // User pause/throttle does not log an attempt or spend retry budget.
    }
    // A crashed HALF_OPEN probe is retried after its endpoint lease expires.
    const gate = beforeAttempt(
      endpoint.circuitState === "HALF_OPEN"
        ? { ...endpoint, circuitState: "OPEN" }
        : endpoint,
    );
    if (!gate.allowed) {
      span.setAttribute("hooka.outcome", "circuit_open");
      count("hooka.circuit.skips");
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
      return; // Skips do not spend the endpoint HTTP attempt budget.
    }
    if (gate.state.circuitState !== endpoint.circuitState) {
      count("hooka.circuit.transitions", { from: endpoint.circuitState, to: gate.state.circuitState, endpoint_id: endpoint.id });
      endpoint = await db.endpoint.update({
        where: { id: endpoint.id },
        data: { circuitState: gate.state.circuitState },
      });
    }
    let raw: string | Buffer;
    let transformError = false;
    const rawReplay = delivery.event.inboundReceipt && await db.inboundReplay.findFirst({
      where: { receiptId: delivery.event.inboundReceipt.id, generation: delivery.generation }, select: { id: true },
    });
    const replayPayload = rawReplay && delivery.event.inboundReceipt ? originalReplayPayload(delivery.event.inboundReceipt) : null;
    try {
      raw = replayPayload
        ? replayPayload.body
        : await transformPayload(endpoint.transform, delivery.event.payload);
    }
    catch { raw = ""; transformError = true; }
    const custom = outboundCustomHeaders(endpoint);
    const original = replayPayload?.headers || {};
    const headers = { ...original, ...custom, ...webhookHeaders(raw, delivery.event, endpoint) };
    if (original["content-type"]) headers["Content-Type"] = original["content-type"];
    if (endpoint.deliveryRatePerMinute) await db.endpoint.updateMany({ where: { id: endpoint.id, leaseToken: token }, data: { nextDeliveryAt: new Date(Date.now() + Math.ceil(60000 / endpoint.deliveryRatePerMinute)) } });
    const result = transformError ? { code: null, body: "", headers: {}, error: "transform_failed", duration: 0 } : await deliver(endpoint.url, raw, headers);
    const success =
      result.code !== null && result.code >= 200 && result.code < 300;
    deliveryMetric(result.duration, success ? "success" : "failure");
    span.setAttribute("http.response.status_code", result.code || 0);
    const retry = retryPlan(endpoint.retryPolicy, delivery.attemptNumber);
    const dead = !success && retry.exhausted;
    const streak = redisConfigured() && !success
      ? await incrementFailureStreak(endpoint.id, endpoint.consecutiveFailures, `${delivery.id}:${delivery.attemptNumber}`)
      : undefined;
    const next = afterAttempt(streak === undefined ? gate.state : { ...gate.state, consecutiveFailures: streak - 1 }, success);
    const delay = retry.delay;
    await db.$transaction(async (tx) => {
      const owned = await tx.endpoint.updateMany({
        where: { id: endpoint.id, leaseToken: token },
        data: redisConfigured()
          ? next.circuitState !== gate.state.circuitState
            ? { circuitState: next.circuitState, circuitOpenedAt: next.circuitOpenedAt, consecutiveFailures: next.consecutiveFailures }
            : {}
          : next,
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
          requestBody: Buffer.isBuffer(raw) ? raw.toString("utf8") : raw,
          requestHeaders: redactedDeliveryHeaders(headers, custom),
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
      if (!delivery.event.operational && endpoint.circuitState === "CLOSED" && next.circuitState === "OPEN") await operationalEvent(tx, endpoint, "endpoint.disabled", { since: next.circuitOpenedAt!.toISOString() });
      if (!delivery.event.operational && endpoint.circuitState !== "CLOSED" && next.circuitState === "CLOSED") await operationalEvent(tx, endpoint, "endpoint.re-enabled", {});
      if (!delivery.event.operational && dead) await operationalEvent(tx, endpoint, "message.failed", { eventId: delivery.eventId, deliveryId: delivery.id });
    });
    if (redisConfigured() && success) await clearFailureStreak(endpoint.id);
    span.setAttributes({ "hooka.outcome": success ? "delivered" : dead ? "dead_lettered" : "retry", "hooka.circuit": next.circuitState, "hooka.delay_ms": success || dead ? 0 : delay.ms });
    if (!success && !dead) count("hooka.delivery.retries", { delay: delay.name });
    if (success || dead) count("hooka.delivery.terminal", { outcome: success ? "delivered" : "dead_lettered" });
    if (gate.state.circuitState !== next.circuitState) count("hooka.circuit.transitions", { from: gate.state.circuitState, to: next.circuitState, endpoint_id: endpoint.id });
    console.log(
      JSON.stringify({
        deliveryId: delivery.id,
        attempt: delivery.attemptNumber,
        status: success ? "DELIVERED" : dead ? "DEAD_LETTERED" : "RETRY",
        circuit: next.circuitState,
      }),
    );
    if (!success && !dead) await flushDelivery(delivery.id);
    if (success || dead) {
      const execution = await db.routingExecution.findUnique({ where: { eventId_generation: { eventId: delivery.eventId, generation: delivery.generation } }, select: { id: true } });
      if (execution) await advanceRoutingExecution(execution.id);
    }
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
  }, delivery.event.traceparent);
}

