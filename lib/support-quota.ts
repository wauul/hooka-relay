import { createHash } from "node:crypto";
import { db } from "./db";
import { requestIp } from "./ip-rate-limit";
class Exhausted extends Error {}
function limit(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}
export async function admitSupport(req: Request, userId?: string) {
  const minute = limit("SUPPORT_LIMIT_PER_MINUTE", 10);
  const day = limit("SUPPORT_LIMIT_PER_DAY", 100);
  const global = limit("SUPPORT_GLOBAL_LIMIT_PER_DAY", 1000);
  const identities = ["ip:" + requestIp(req), ...(userId ? ["user:" + userId] : [])];
  const budgets = identities.flatMap(identity => {
    const hash = createHash("sha256").update(identity).digest("hex");
    return [{ key: `support:minute:${hash}`, seconds: 60, max: minute }, { key: `support:day:${hash}`, seconds: 86400, max: day }];
  });
  budgets.push({ key: "support:global:day", seconds: 86400, max: global });
  // Lock in stable order and roll back every increment on rejection. This
  // prevents concurrent replicas spending the same quota, partial admissions
  // consuming another user's budget, and distributed IPs bypassing a global cap.
  budgets.sort((a, b) => a.key.localeCompare(b.key));
  try {
    await db.$transaction(async tx => {
      for (const budget of budgets) {
        const admitted = await tx.$queryRaw<{ hits: number }[]>`
          INSERT INTO "IpRateBucket" (key, bucket, hits, "expiresAt")
          VALUES (${budget.key}, FLOOR(EXTRACT(EPOCH FROM NOW()) / ${budget.seconds})::bigint, 1, NOW() + interval '2 days')
          ON CONFLICT (key, bucket) DO UPDATE SET hits = "IpRateBucket".hits + 1
          WHERE "IpRateBucket".hits < ${budget.max} RETURNING hits`;
        if (!admitted.length) throw new Exhausted();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof Exhausted) return false;
    // Database failure must fail closed rather than granting free inference.
    throw error;
  }
}
