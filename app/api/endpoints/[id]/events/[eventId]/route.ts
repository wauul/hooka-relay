import { db } from "@/lib/db";
import { ownEndpoint, apiError } from "@/lib/access";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  try {
    const ep = await ownEndpoint((await params).id);
    const event = await db.event.findFirst({
      where: { id: (await params).eventId, applicationId: ep.applicationId },
    });
    if (!event) throw new Error("NOT_FOUND");
    const [attempts, deliveries] = await Promise.all([
      db.deliveryAttempt.findMany({
        where: { endpointId: ep.id, eventId: event.id },
        orderBy: { createdAt: "desc" },
      }),
      db.delivery.findMany({
        where: { endpointId: ep.id, eventId: event.id },
        orderBy: { generation: "desc" },
      }),
    ]);
    return Response.json({ event, attempts, deliveries });
  } catch (e) {
    return apiError(e);
  }
}
