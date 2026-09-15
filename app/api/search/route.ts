import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchSite, type SearchResult } from "@/lib/site";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (query.length < 2) return json({ results: [] });
  if (query.length > 100)
    return json({ error: "Use 100 characters or fewer." }, 400);
  const results: SearchResult[] = searchSite(query);
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (userId) {
      const contains = { contains: query, mode: "insensitive" as const };
      const [apps, endpoints, events] = await Promise.all([
        db.application.findMany({
          where: { userId, OR: [{ name: contains }, { id: contains }] },
          take: 8,
          select: { id: true, name: true },
        }),
        db.endpoint.findMany({
          where: {
            application: { userId },
            OR: [
              { url: contains },
              { id: contains },
              { eventTypes: { has: query } },
            ],
          },
          take: 8,
          select: {
            id: true,
            url: true,
            application: { select: { name: true } },
          },
        }),
        db.event.findMany({
          where: {
            application: { userId },
            OR: [
              { id: contains },
              { type: contains },
              { idempotencyKey: contains },
            ],
          },
          take: 8,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            type: true,
            applicationId: true,
            deliveries: { take: 1, select: { endpointId: true } },
          },
        }),
      ]);
      results.push(
        ...apps.map((a) => ({
          title: a.name,
          description: a.id,
          href: `/applications/${a.id}`,
          category: "Application",
        })),
        ...endpoints.map((e) => ({
          title: e.url,
          description: e.application.name,
          href: `/endpoints/${e.id}`,
          category: "Endpoint",
        })),
        ...events.map((e) => ({
          title: e.type,
          description: e.id,
          href: e.deliveries[0]
            ? `/endpoints/${e.deliveries[0].endpointId}/events/${e.id}`
            : `/applications/${e.applicationId}`,
          category: "Event",
        })),
      );
    }
    return json({ results });
  } catch {
    return json({
      results,
      warning:
        "Workspace search is temporarily unavailable. Documentation results are still shown.",
    });
  }
}
