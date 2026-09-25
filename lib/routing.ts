import type { Prisma, RoutingRunStatus, RoutingSuccessPolicy, RoutingTriggerCondition } from "@prisma/client";
import { db } from "./db";
import { flushDelivery } from "./events";

export function resolveGroup(policy: RoutingSuccessPolicy, outcomes: ("SUCCESS" | "FAILED")[]): "SUCCESS" | "FAILED" {
  if (!outcomes.length) return "FAILED";
  return policy === "ALL_MUST_SUCCEED"
    ? outcomes.every(outcome => outcome === "SUCCESS") ? "SUCCESS" : "FAILED"
    : outcomes.some(outcome => outcome === "SUCCESS") ? "SUCCESS" : "FAILED";
}
export function shouldRun(condition: RoutingTriggerCondition, previous: RoutingRunStatus | null) {
  return previous === null || condition === "ALWAYS" || (condition === "ON_PREVIOUS_SUCCESS" && previous === "SUCCESS") || (condition === "ON_PREVIOUS_FAILURE" && previous === "FAILED");
}

// A route is snapshotted when an event is accepted. Editing the builder cannot
// change an in-flight event's remaining destinations or conditions.
export async function createRoutingExecution(tx: Prisma.TransactionClient, eventId: string, sourceId: string, generation = 0) {
  const [event, source] = await Promise.all([
    tx.event.findUnique({ where: { id: eventId }, select: { applicationId: true, customerId: true } }),
    tx.webhookSource.findUnique({ where: { id: sourceId }, select: { applicationId: true, customerId: true } }),
  ]);
  if (!event || !source || event.applicationId !== source.applicationId || event.customerId !== source.customerId) throw new Error("Source event customer mismatch");
  const groups = await tx.destinationGroup.findMany({ where: { webhookSourceId: sourceId }, orderBy: { order: "asc" }, include: { destinations: { include: { endpoint: { select: { id: true, url: true, applicationId: true, customerId: true } } } } } });
  if (!groups.length) return false;
  if (groups.some(group => group.destinations.some(destination => destination.endpoint.applicationId !== source.applicationId || destination.endpoint.customerId !== source.customerId))) throw new Error("Source destination customer mismatch");
  const execution = await tx.routingExecution.create({ data: { eventId, webhookSourceId: sourceId, generation,
    groups: { create: groups.map((group, index) => ({ order: index, triggerCondition: group.triggerCondition, successPolicy: group.successPolicy,
      destinations: { create: group.destinations.map(destination => ({ endpointId: destination.endpointId, url: destination.endpoint.url })) },
    })) },
  } });
  await advanceRoutingExecutionTx(tx, execution.id);
  return true;
}
export async function createRoutingReplay(tx: Prisma.TransactionClient, eventId: string, sourceId: string) {
  await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  const prior = await tx.delivery.findMany({ where: { eventId }, select: { generation: true } });
  const executions = await tx.routingExecution.findMany({ where: { eventId }, select: { generation: true } });
  const generation = Math.max(-1, ...prior.map(delivery => delivery.generation), ...executions.map(execution => execution.generation)) + 1;
  const created = await createRoutingExecution(tx, eventId, sourceId, generation);
  if (!created) throw new Error("No routing groups configured");
  const queued = await tx.delivery.count({ where: { eventId, generation } });
  return { generation, queued };
}

async function advanceRoutingExecutionTx(tx: Prisma.TransactionClient, executionId: string) {
  const execution = await tx.routingExecution.findUniqueOrThrow({ where: { id: executionId }, include: { groups: { orderBy: { order: "asc" }, include: { destinations: { include: { delivery: { select: { status: true } }, endpoint: { select: { status: true } } } } } } } });
  if (execution.status !== "RUNNING") return;
  let previous: RoutingRunStatus | null = null;
  for (const group of execution.groups) {
    if (group.status === "SUCCESS" || group.status === "FAILED" || group.status === "SKIPPED") { previous = group.status; continue; }
    if (group.status === "RUNNING") {
      if (group.destinations.some(destination => destination.delivery?.status === "PENDING")) return;
      const outcomes = group.destinations.map(destination => destination.delivery?.status === "DELIVERED" ? "SUCCESS" as const : "FAILED" as const);
      const status = resolveGroup(group.successPolicy, outcomes);
      await tx.routingGroupRun.update({ where: { id: group.id }, data: { status } });
      previous = status;
      continue;
    }
    if (!shouldRun(group.triggerCondition, previous)) {
      await tx.routingGroupRun.update({ where: { id: group.id }, data: { status: "SKIPPED", reason: `Previous group ${previous?.toLowerCase() || "did not run"}` } });
      previous = "SKIPPED";
      continue;
    }
    await tx.routingGroupRun.update({ where: { id: group.id }, data: { status: "RUNNING" } });
    for (const destination of group.destinations) {
      if (!destination.endpointId || destination.endpoint?.status !== "ACTIVE") continue;
      const delivery = await tx.delivery.create({ data: { eventId: execution.eventId, endpointId: destination.endpointId, generation: execution.generation } });
      await tx.routingDestinationRun.update({ where: { id: destination.id }, data: { deliveryId: delivery.id } });
    }
    // No active destination means an immediate failed group; the next watchdog
    // pass advances it. Normal groups wait for the existing delivery worker.
    return;
  }
  await tx.routingExecution.update({ where: { id: execution.id }, data: { status: previous === "SUCCESS" ? "SUCCESS" : "FAILED", completedAt: new Date() } });
}

export async function advanceRoutingExecution(executionId: string) {
  const before = await db.routingExecution.findUnique({ where: { id: executionId }, select: { eventId: true, generation: true } });
  if (!before) return;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "RoutingExecution" WHERE id = ${executionId} FOR UPDATE`;
    await advanceRoutingExecutionTx(tx, executionId);
  });
  const pending = await db.delivery.findMany({ where: { eventId: before.eventId, generation: before.generation, status: "PENDING", publishedAt: null }, select: { id: true } });
  await Promise.allSettled(pending.map(delivery => flushDelivery(delivery.id)));
}
