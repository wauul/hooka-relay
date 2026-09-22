import { replayEvent } from "@/lib/replay";
import { z } from "zod";
import { db } from "@/lib/db";
import { userId, apiError, sameOrigin } from "@/lib/access";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const uid = await userId();
    const event = await db.event.findFirst({
      where: { id: (await params).id, application: { workspace: { members: { some: { userId: uid } } } } },
    });
    if (!event) throw new Error("NOT_FOUND");
    const raw = await req.text();
    const { endpointId: requestedEndpoint } = z.object({ endpointId: z.string().min(1).optional() }).parse(raw ? JSON.parse(raw) : {});
    if (requestedEndpoint && !await db.endpoint.findFirst({ where: { id: requestedEndpoint, applicationId: event.applicationId, status: "ACTIVE", OR: [{ eventTypes: { has: "*" } }, { eventTypes: { has: event.type } }] } })) throw new Error("NOT_FOUND");
    const result = await db.$transaction(tx => replayEvent(tx, event.id, requestedEndpoint ? [requestedEndpoint] : undefined));
    return Response.json({ queued: result.queued }, { status: 202 });
  } catch (e) {
    return apiError(e);
  }
}
