import { db } from "@/lib/db";
import { apiError, ownApplication } from "@/lib/access";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const source = await db.webhookSource.findUnique({ where: { id: (await params).id }, select: { applicationId: true } });
    if (!source) throw new Error("NOT_FOUND");
    await ownApplication(source.applicationId);
    const query = new URL(req.url).searchParams;
    const search = (query.get("q") || "").trim();
    if (search.length > 100) throw new Error("Search is too long");
    const since = query.get("since"), until = query.get("until"), verified = query.get("verified"), cursor = query.get("cursor");
    if ((since && Number.isNaN(Date.parse(since))) || (until && Number.isNaN(Date.parse(until))) || (verified && !["true", "false"].includes(verified)) || (cursor && cursor.length > 100)) throw new Error("Invalid filter");
    const receipts = await db.inboundReceipt.findMany({
      where: { sourceId: (await params).id,
        ...(since || until ? { receivedAt: { ...(since ? { gte: new Date(since) } : {}), ...(until ? { lte: new Date(until) } : {}) } } : {}),
        ...(verified ? { verified: verified === "true" } : {}),
        ...(search ? { searchText: { contains: search, mode: "insensitive" } } : {}),
      },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, eventId: true, eventType: true, provider: true, verified: true, failureReason: true, receivedAt: true,
        _count: { select: { replays: true, liveAttempts: true } },
      },
    });
    const hasMore = receipts.length > 50;
    return Response.json({ receipts: receipts.slice(0, 50), nextCursor: hasMore ? receipts[49].id : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
