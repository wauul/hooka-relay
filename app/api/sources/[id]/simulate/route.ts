import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ownApplication, apiError, sameOrigin } from "@/lib/access";
import { admitEvent } from "@/lib/rate-limit";
import { ingest } from "@/lib/events";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req);
    const source = await db.webhookSource.findUnique({ where: { id: (await params).id } });
    if (!source) throw new Error("NOT_FOUND");
    await ownApplication(source.applicationId, "manage");
    if (!source.endpointId || !source.destinationUrl) throw new Error("Set a destination first");
    const retryAfter = await admitEvent(source.applicationId);
    if (retryAfter) return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    const event = await ingest(source.applicationId, {
      type: "inbound.simulated",
      payload: { provider: source.provider, simulated: true, message: "Hooka Relay setup test", sourceId: source.id },
      idempotencyKey: `inbound-simulated:${source.id}:${randomUUID()}`,
    }, { endpointId: source.endpointId, webhookSourceId: source.id, synthetic: true });
    return Response.json({ eventId: event.id, simulated: true }, { status: 202 });
  } catch (error) { return apiError(error); }
}
