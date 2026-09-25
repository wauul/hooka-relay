import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ownApplication, apiError } from "@/lib/access";

type Context = { params: Promise<{ id: string }> };
type DayRow = { day: string; count: number };

export async function GET(req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const app = await ownApplication(id, "view");
    const customerId = new URL(req.url).searchParams.get("customerId");
    const customer = customerId ? await db.customer.findFirst({ where: { id: customerId, applicationId: id }, select: { id: true, name: true, externalId: true, createdAt: true, portalTokenHash: true } }) : null;
    if (customerId && !customer) throw new Error("NOT_FOUND");

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 13);
    const eventWhere = { applicationId: id, createdAt: { gte: start }, ...(customerId ? { customerId } : {}) };
    const endpointWhere = { applicationId: id, ...(customerId ? { customerId } : {}) };
    const scope = customerId ? Prisma.sql`AND "customerId" = ${customerId}` : Prisma.empty;
    const [endpoints, activeEndpoints, sources, events, deliveries, dailyRows, recentEvents, endpointRows, sourceRows] = await Promise.all([
      db.endpoint.count({ where: endpointWhere }),
      db.endpoint.count({ where: { ...endpointWhere, status: "ACTIVE" } }),
      db.webhookSource.count({ where: endpointWhere }),
      db.event.count({ where: eventWhere }),
      db.delivery.groupBy({ by: ["status"], where: { event: eventWhere }, _count: { _all: true } }),
      db.$queryRaw<DayRow[]>`SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS count FROM "Event" WHERE "applicationId" = ${id} AND "createdAt" >= ${start} ${scope} GROUP BY 1 ORDER BY 1`,
      customerId ? db.event.findMany({ where: { applicationId: id, customerId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, type: true, createdAt: true } }) : [],
      customerId ? db.endpoint.findMany({ where: { applicationId: id, customerId, kind: { not: "INBOUND" } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, url: true, status: true } }) : [],
      customerId ? db.webhookSource.findMany({ where: { applicationId: id, customerId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, provider: true, status: true } }) : [],
    ]);
    const byDay = new Map(dailyRows.map(row => [row.day, row.count]));
    const dailyEvents = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const day = date.toISOString().slice(0, 10);
      return { day, count: byDay.get(day) || 0 };
    });
    return Response.json({ canManage: app.role !== "MEMBER", customer: customer ? { id: customer.id, name: customer.name, externalId: customer.externalId, createdAt: customer.createdAt, portalEnabled: !!customer.portalTokenHash } : null, endpoints, activeEndpoints, sources, events, deliveries: Object.fromEntries(deliveries.map(row => [row.status, row._count._all])), dailyEvents, recentEvents, endpointRows, sourceRows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
