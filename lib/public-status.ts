import { unstable_cache } from "next/cache";
import { db } from "./db";
import { summarizeStatus } from "./status-summary";
export const publicStatus = unstable_cache(async () => {
  // Aggregate in Postgres: no tenant identities, destination URLs or payloads
  // leave the database. Cache globally to bound unauthenticated query traffic.
  const rows = await db.$queryRaw<{ at: Date; total: number; success: number }[]>`
    SELECT to_timestamp(floor(extract(epoch FROM "createdAt") / 300) * 300) AS at,
      count(*)::int AS total, count(*) FILTER (WHERE status = 'SUCCESS')::int AS success
    FROM "DeliveryAttempt" WHERE "createdAt" >= NOW() - interval '24 hours'
      AND status <> 'SKIPPED_CIRCUIT_OPEN'
    GROUP BY 1 ORDER BY 1`;
  return summarizeStatus(rows.map(r => ({ ...r, at: r.at.toISOString() })));
}, ["public-status-v1"], { revalidate: 60 });
