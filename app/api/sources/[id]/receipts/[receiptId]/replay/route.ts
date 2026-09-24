import { db } from "@/lib/db";
import { apiError, ownApplication, sameOrigin, userId } from "@/lib/access";
import { replayEvent } from "@/lib/replay";
import { flushDelivery } from "@/lib/events";
import { publishInboundLive } from "@/lib/queue/client";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  try {
    sameOrigin(req);
    const { id, receiptId } = await params;
    const receipt = await db.inboundReceipt.findFirst({ where: { id: receiptId, sourceId: id }, include: { source: true } });
    if (!receipt) throw new Error("NOT_FOUND");
    await ownApplication(receipt.source.applicationId, "manage");
    if (!receipt.verified || !receipt.eventId) throw new Error("Only verified events can be replayed");
    if (receipt.source.status === "PAUSED") throw new Error("Resume this source before replaying");
    const endpointId = receipt.source.destinationUrl ? receipt.source.endpointId : null;
    const listeners = await db.inboundLiveSession.count({ where: { sourceId: id, lastSeenAt: { gt: new Date(Date.now() - 45000) } } });
    if (!endpointId && !listeners) throw new Error("Configure a destination or start hooka listen before replaying");
    const actor = await userId();
    const result = await db.$transaction(async tx => {
      const delivery = endpointId ? await replayEvent(tx, receipt.eventId!, [endpointId]) : null;
      const audit = await tx.inboundReplay.create({ data: { receiptId, userId: actor, generation: delivery?.generation ?? null } });
      return { audit, delivery };
    });
    if (result.delivery) {
      const pending = await db.delivery.findMany({ where: { eventId: receipt.eventId!, generation: result.delivery.generation }, select: { id: true } });
      await Promise.allSettled(pending.map(item => flushDelivery(item.id)));
    }
    const liveQueued = await publishInboundLive(id, receiptId, result.audit.id).then(() => true, () => false);
    return Response.json({ replayId: result.audit.id, generation: result.delivery?.generation ?? null,
      queuedDestinations: result.delivery?.queued ?? 0, liveListeners: listeners, liveQueued,
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
