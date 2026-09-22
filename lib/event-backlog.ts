import { db } from "./db";
import { z } from "zod";
import { WorkspaceError } from "./workspaces";
const pageCursor = z.object({ time: z.string().datetime(), id: z.string().min(1).max(100) });
export async function eventBacklog(applicationId: string, url: URL) {
  const endpointId = z.string().min(1).max(100).nullable().parse(url.searchParams.get("endpoint_id"));
  const endpoint = endpointId ? await db.endpoint.findFirst({ where: { id: endpointId, applicationId } }) : null;
  if (endpointId && !endpoint) throw new WorkspaceError(404, "Endpoint not found");
  const since = z.string().max(100).nullable().parse(url.searchParams.get("since"));
  let boundary: { createdAt: Date; id?: string } | undefined;
  if (since) {
    const date = z.string().datetime().safeParse(since);
    if (date.success) boundary = { createdAt: new Date(date.data) };
    else {
      const event = await db.event.findFirst({ where: { id: since, applicationId }, select: { id: true, createdAt: true } });
      if (!event) throw new WorkspaceError(400, "since must be an ISO timestamp or an event ID in this application");
      boundary = event;
    }
  }
  const cursor = z.string().max(512).nullable().parse(url.searchParams.get("cursor"));
  if (cursor) { const parsed = pageCursor.parse(JSON.parse(Buffer.from(cursor, "base64url").toString())); boundary = { createdAt: new Date(parsed.time), id: parsed.id }; }
  const limit = z.coerce.number().int().min(1).max(100).parse(url.searchParams.get("limit") || 50);
  const events = await db.event.findMany({ where: {
    applicationId,
    AND: [
      ...(boundary ? [{ OR: [{ createdAt: { gt: boundary.createdAt } }, ...(boundary.id ? [{ createdAt: boundary.createdAt, id: { gt: boundary.id } }] : [])] }] : []),
      ...(endpoint ? [{ OR: [{ deliveries: { some: { endpointId: endpoint.id } } }, { operational: endpoint.kind === "OPERATIONAL", ...(endpoint.eventTypes.includes("*") ? {} : { type: { in: endpoint.eventTypes } }) }] }] : []),
    ],
  }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1 });
  const page = events.slice(0, limit), last = page.at(-1);
  return { events: page, hasMore: events.length > limit, nextCursor: events.length > limit && last ? Buffer.from(JSON.stringify({ time: last.createdAt.toISOString(), id: last.id })).toString("base64url") : null };
}
