import type { Prisma } from "@prisma/client";
import { WorkspaceError } from "./workspaces";
// Every replay uses the existing per-event lock and a new immutable generation.
export async function replayEvent(tx: Prisma.TransactionClient, eventId: string, requested?: string[], dueAt?: Date) {
  await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { applicationId: true, customerId: true } });
  const existing = await tx.delivery.findMany({ where: { eventId }, select: { endpointId: true, generation: true } });
  const generation = Math.max(-1, ...existing.map(d => d.generation)) + 1;
  const ids = requested ?? [...new Set(existing.map(d => d.endpointId))];
  if (ids.length !== await tx.endpoint.count({ where: { id: { in: ids }, applicationId: event.applicationId, customerId: event.customerId } }))
    throw new WorkspaceError(404, "Endpoint not found");
  await tx.delivery.createMany({ data: ids.map(endpointId => ({ eventId, endpointId, generation, ...(dueAt ? { dueAt } : {}) })) });
  return { eventId, generation, queued: ids.length };
}
