import { db } from "@/lib/db";
import { apiError, ownApplication } from "@/lib/access";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  try {
    const { id, receiptId } = await params;
    const receipt = await db.inboundReceipt.findFirst({ where: { id: receiptId, sourceId: id }, include: { source: { select: { applicationId: true, name: true } }, replays: { orderBy: { createdAt: "desc" } }, liveAttempts: { orderBy: { createdAt: "desc" } } } });
    if (!receipt) throw new Error("NOT_FOUND");
    await ownApplication(receipt.source.applicationId);
    if (new URL(req.url).searchParams.get("raw") === "1") return new Response(Buffer.from(receipt.rawBody, "base64"), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="inbound-${receipt.id}.bin"`, "Cache-Control": "no-store" },
    });
    const [deliveries, attempts] = receipt.eventId ? await Promise.all([
      db.delivery.findMany({ where: { eventId: receipt.eventId }, orderBy: { generation: "desc" }, include: { endpoint: { select: { url: true } } } }),
      db.deliveryAttempt.findMany({ where: { eventId: receipt.eventId }, orderBy: { createdAt: "desc" } }),
    ]) : [[], []];
    // Only this authenticated workspace view exposes verification failures;
    // the public ingestion response deliberately reveals no signature detail.
    return Response.json({ id: receipt.id, sourceId: receipt.sourceId, sourceName: receipt.source.name, eventId: receipt.eventId,
      provider: receipt.provider, eventType: receipt.eventType, verified: receipt.verified, failureReason: receipt.failureReason,
      receivedAt: receipt.receivedAt, rawHeaders: receipt.rawHeaders, rawBody: receipt.searchText,
      bodyBase64: receipt.rawBody, deliveries, attempts, liveAttempts: receipt.liveAttempts, replays: receipt.replays,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
