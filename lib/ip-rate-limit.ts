import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { db } from "./db";
import { admitFixedWindow, redisConfigured } from "./redis-counters";
// Only the platform-controlled header is trusted. Self-hosted deployments use
// a shared bucket until a trusted ingress is configured, never spoofable XFF.
export function requestIp(req: Request) {
  const address =
    process.env.VERCEL === "1"
      ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()
      : undefined;
  return address && isIP(address) ? address : "unidentified";
}
export async function ipRateLimit(req: Request, scope: "events" | "auth" | "portal" | "recovery") {
  const configured = Number(
    process.env[
      scope === "recovery" ? "RECOVERY_IP_LIMIT_PER_MINUTE" : scope === "events"
        ? "EVENTS_IP_LIMIT_PER_MINUTE"
        : scope === "portal" ? "PORTAL_IP_LIMIT_PER_MINUTE" : "AUTH_IP_LIMIT_PER_MINUTE"
    ] || (scope === "recovery" ? 5 : scope === "events" ? 1000 : scope === "portal" ? 30 : 20),
  );
  if (!Number.isSafeInteger(configured) || configured < 1)
    throw new Error("Invalid IP rate limit");
  const key =
    scope + ":" + createHash("sha256").update(requestIp(req)).digest("hex");
  const admitted = redisConfigured()
    ? await admitFixedWindow(key, 60, configured)
    : (await db.$queryRaw<{ hits: number }[]>`
      INSERT INTO "IpRateBucket" (key, bucket, hits, "expiresAt")
      VALUES (${key}, FLOOR(EXTRACT(EPOCH FROM NOW()) / 60)::bigint, 1, NOW() + interval '2 minutes')
      ON CONFLICT (key, bucket) DO UPDATE SET hits = "IpRateBucket".hits + 1
      WHERE "IpRateBucket".hits < ${configured} RETURNING hits`).length > 0;
  // A single atomic upsert prevents parallel requests/serverless replicas from
  // spending the same admission. Keys are hashed so raw IPs are not persisted.
  if (!admitted)
    return Response.json(
      { error: "Too many requests. Try again shortly.", retryAfter: 60 },
      {
        status: 429,
        headers: { "Retry-After": "60", "Cache-Control": "no-store" },
      },
    );
  return null;
}
