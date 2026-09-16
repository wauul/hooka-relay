import { db } from "./db";

export function eventRateLimit() {
  const value = Number(process.env.EVENTS_RATE_LIMIT_PER_MINUTE || 100);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid EVENTS_RATE_LIMIT_PER_MINUTE");
  return value;
}

// Serialize admissions on the application row across all serverless replicas.
// Both keys share this rolling 60-second budget during rotation.
export async function admitEvent(applicationId: string) {
  const limit = eventRateLimit();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const cutoff = new Date(now.getTime() - 60_000);
    await tx.eventAdmission.deleteMany({ where: { applicationId, createdAt: { lte: cutoff } } });
    const count = await tx.eventAdmission.count({ where: { applicationId } });
    if (count >= limit) {
      const first = await tx.eventAdmission.findFirstOrThrow({ where: { applicationId }, orderBy: { createdAt: "asc" } });
      return Math.max(1, Math.ceil((first.createdAt.getTime() + 60_000 - now.getTime()) / 1000));
    }
    await tx.eventAdmission.create({ data: { applicationId, createdAt: now } });
    return 0;
  });
}
