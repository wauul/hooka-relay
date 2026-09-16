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
    const deliveries = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${event.id} FOR UPDATE`;
      const existing = await tx.delivery.findMany({
        where: { eventId: event.id },
        select: { endpointId: true, generation: true },
      });
      const generation = Math.max(-1, ...existing.map((d) => d.generation)) + 1;
      const endpointIds = requestedEndpoint ? [requestedEndpoint] : [...new Set(existing.map((d) => d.endpointId))];
      return Promise.all(
        endpointIds.map((endpointId) =>
          tx.delivery.create({
            data: { eventId: event.id, endpointId, generation },
          }),
        ),
      );
    });
    return Response.json({ queued: deliveries.length }, { status: 202 });
  } catch (e) {
    return apiError(e);
  }
}
