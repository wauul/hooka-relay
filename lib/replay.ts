import type { Prisma } from "@prisma/client";
// Every replay uses the existing per-event lock and a new immutable generation.
export async function replayEvent(tx: Prisma.TransactionClient, eventId: string, requested?: string[], dueAt?: Date) {
  await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  const existing = await tx.delivery.findMany({ where: { eventId }, select: { endpointId: true, generation: true } });
  const generation = Math.max(-1, ...existing.map(d => d.generation)) + 1;
  const ids = requested ?? [...new Set(existing.map(d => d.endpointId))];
  await tx.delivery.createMany({ data: ids.map(endpointId => ({ eventId, endpointId, generation, ...(dueAt ? { dueAt } : {}) })) });
  return { eventId, generation, queued: ids.length };
}
