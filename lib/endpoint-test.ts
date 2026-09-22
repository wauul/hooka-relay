import { randomUUID } from "node:crypto";
import { db } from "./db";
import { ingest } from "./events";
import { admitEvent } from "./rate-limit";
import { WorkspaceError } from "./workspaces";

export async function sendEndpointTest(endpoint: { id: string; applicationId: string; status: string; circuitState: string }) {
  if (endpoint.status !== "ACTIVE" || endpoint.circuitState !== "CLOSED") throw new WorkspaceError(409, "Synthetic tests require an active endpoint with a closed circuit. Resume it or wait for the normal recovery probe.");
  const key = `endpoint-test:${endpoint.id}`;
  // Shared across users and serverless replicas; never bypass receiver protection.
  const admission = await db.$queryRaw<{ hits: number }[]>`
    INSERT INTO "IpRateBucket" (key, bucket, hits, "expiresAt")
    VALUES (${key}, FLOOR(EXTRACT(EPOCH FROM NOW()) / 60)::bigint, 1, NOW() + interval '2 minutes')
    ON CONFLICT (key, bucket) DO UPDATE SET hits = "IpRateBucket".hits + 1
    WHERE "IpRateBucket".hits < 5 RETURNING hits`;
  if (!admission.length) return { limited: 60 } as const;
  const limited = await admitEvent(endpoint.applicationId);
  if (limited) return { limited } as const;
  const event = await ingest(endpoint.applicationId, {
    type: "hooka.test", idempotencyKey: `synthetic-${randomUUID()}`,
    payload: { hookaTest: true, sentAt: new Date().toISOString() },
  }, { endpointId: endpoint.id });
  return { eventId: event.id } as const;
}
