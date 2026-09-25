import { Prisma } from "@prisma/client";
import { db } from "./db";
import { WorkspaceError } from "./workspaces";
import { replayEvent } from "./replay";
import { observe } from "./observability";
export async function startRecovery(applicationId: string, since: Date, endpointId?: string, customerId?: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
    if (endpointId && !await tx.endpoint.findFirst({ where: { id: endpointId, applicationId, ...(customerId ? { customerId } : {}) } })) throw new WorkspaceError(404, "Endpoint not found");
    if (await tx.recoveryJob.findFirst({ where: { applicationId, customerId: customerId || null, status: "PENDING" } })) throw new WorkspaceError(409, "A recovery is already running");
    const availableAt = customerId
      ? (await tx.customer.findFirst({ where: { id: customerId, applicationId }, select: { recoveryAvailableAt: true } }))?.recoveryAvailableAt
      : (await tx.application.findUniqueOrThrow({ where: { id: applicationId } })).recoveryAvailableAt;
    if (customerId && availableAt === undefined) throw new WorkspaceError(404, "Customer not found");
    if (availableAt && availableAt > new Date()) throw new WorkspaceError(429, "Recovery rate limit: wait one minute");
    if (customerId) await tx.customer.update({ where: { id: customerId }, data: { recoveryAvailableAt: new Date(Date.now() + 60000) } });
    else await tx.application.update({ where: { id: applicationId }, data: { recoveryAvailableAt: new Date(Date.now() + 60000) } });
    return tx.recoveryJob.create({ data: { applicationId, customerId, endpointId, since } });
  });
}
export async function drainRecovery() {
  const jobs = await db.recoveryJob.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 10 });
  for (const job of jobs) {
    const completed = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "RecoveryJob" WHERE id = ${job.id} FOR UPDATE`;
    const fresh = await tx.recoveryJob.findUnique({ where: { id: job.id } });
    if (!fresh || fresh.status !== "PENDING") return false;
    // Only the latest terminal generation qualifies; a delivered or pending
    // replay is never selected again after a crash or repeated drain.
    const failed = await tx.$queryRaw<{ eventId: string; endpointId: string }[]>(Prisma.sql`
      SELECT d."eventId", d."endpointId" FROM "Delivery" d JOIN "Event" e ON e.id = d."eventId"
      WHERE e."applicationId" = ${job.applicationId} ${job.customerId ? Prisma.sql`AND e."customerId" = ${job.customerId}` : Prisma.empty} AND e."createdAt" >= ${job.since} AND e."createdAt" <= ${job.until}
      AND d.status = 'DEAD_LETTERED' AND d."createdAt" <= ${job.until} ${job.endpointId ? Prisma.sql`AND d."endpointId" = ${job.endpointId}` : Prisma.empty}
      AND NOT EXISTS (SELECT 1 FROM "Delivery" n WHERE n."eventId" = d."eventId" AND n."endpointId" = d."endpointId" AND n.generation > d.generation)
      ORDER BY d."createdAt", d.id LIMIT 5`);
    let queued = 0;
    for (const candidate of failed) {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${candidate.eventId} FOR UPDATE`;
      const latest = await tx.delivery.findFirst({ where: candidate, orderBy: { generation: "desc" } });
      if (latest?.status !== "DEAD_LETTERED" || latest.createdAt > job.until) continue;
      await replayEvent(tx, candidate.eventId, [candidate.endpointId], new Date(Date.now() + queued * 1000)); queued++;
    }
    await tx.recoveryJob.update({ where: { id: job.id }, data: { queued: { increment: queued }, ...(failed.length ? {} : { status: "COMPLETE" }) } });
    return failed.length === 0;
  });
    if (completed) observe("hooka.recovery.duration", Math.max(0, (Date.now() - job.createdAt.getTime()) / 1000));
  }
}
