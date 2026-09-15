import { z } from "zod";
import { db } from "./db";
import { newSecret, resolveEndpoint } from "./security";

const endpointFields = { id: true, url: true, eventTypes: true, circuitState: true, createdAt: true } as const;
class ApiFailure extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const cursorSchema = z.object({ time: z.string().datetime(), id: z.string().max(100) });
function cursor(value: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ time: value.createdAt.toISOString(), id: value.id })).toString("base64url");
}

// Application keys grant access only to their own application's resources.
// Dashboard session routes retain their existing authentication and CSRF rules.
export async function cliApi(req: Request, path: string[]) {
  try {
    const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key");
    if (!key) throw new ApiFailure(401, "API key required");
    const app = await db.application.findUnique({ where: { apiKey: key }, select: { id: true, name: true, createdAt: true } });
    if (!app) throw new ApiFailure(401, "Invalid API key");
    const url = new URL(req.url);
    const route = path.join("/");
    if (req.method === "GET" && route === "me") return json({ application: app });
    if (route === "endpoints" && req.method === "GET") {
      const endpoints = await db.endpoint.findMany({ where: { applicationId: app.id }, select: endpointFields, orderBy: { createdAt: "asc" } });
      const counts = await db.deliveryAttempt.groupBy({
        by: ["endpointId", "status"],
        where: { endpoint: { applicationId: app.id }, createdAt: { gte: new Date(Date.now() - 86400000) }, status: { not: "SKIPPED_CIRCUIT_OPEN" } },
        _count: { _all: true },
      });
      return json({ endpoints: endpoints.map(ep => {
        const rows = counts.filter(c => c.endpointId === ep.id);
        const total = rows.reduce((n, c) => n + c._count._all, 0);
        const success = rows.find(c => c.status === "SUCCESS")?._count._all || 0;
        return { ...ep, successRate: total ? Math.round(success * 100 / total) : null };
      }) });
    }
    if (route === "endpoints" && req.method === "POST") {
      const body = await req.text();
      if (Buffer.byteLength(body) > 16384) throw new ApiFailure(413, "Endpoint request is too large");
      const input = z.object({ url: z.string().url().max(2000), eventTypes: z.array(z.string().min(1).max(120).regex(/^(\*|[A-Za-z0-9_.:-]+)$/)).min(1).max(50).default(["*"]) }).parse(JSON.parse(body));
      await resolveEndpoint(input.url);
      const endpoint = await db.endpoint.create({ data: { applicationId: app.id, ...input, secret: newSecret() }, select: { ...endpointFields, secret: true } });
      return json({ endpoint }, 201);
    }
    if (route === "attempts" && req.method === "GET") {
      const endpointId = url.searchParams.get("endpoint") || undefined;
      if (endpointId && !await db.endpoint.findFirst({ where: { id: endpointId, applicationId: app.id }, select: { id: true } })) throw new ApiFailure(404, "Endpoint not found");
      const raw = url.searchParams.get("after");
      const after = raw ? cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString())) : null;
      const attempts = await db.deliveryAttempt.findMany({
        where: { endpoint: { applicationId: app.id }, endpointId, ...(after ? { OR: [{ createdAt: { gt: new Date(after.time) } }, { createdAt: new Date(after.time), id: { gt: after.id } }] } : {}) },
        orderBy: after ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }], take: 101,
        select: { id: true, eventId: true, endpointId: true, deliveryId: true, attemptNumber: true, status: true, httpStatusCode: true, durationMs: true, createdAt: true, event: { select: { type: true } }, endpoint: { select: { url: true } } },
      });
      const hasMore = !!after && attempts.length > 100;
      const page = attempts.slice(0, 100);
      if (!after) page.reverse();
      return json({ attempts: page, nextCursor: page.length ? cursor(page[page.length - 1]) : raw, hasMore });
    }
    if (path[0] === "events" && path[1] && (path.length === 2 || (path.length === 3 && path[2] === "replay"))) {
      const event = await db.event.findFirst({ where: { id: path[1], applicationId: app.id } });
      if (!event) throw new ApiFailure(404, "Event not found");
      if (req.method === "POST" && path[2] === "replay") {
        // Same row lock and durable-outbox semantics as dashboard replay.
        const result = await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${event.id} FOR UPDATE`;
          const existing = await tx.delivery.findMany({ where: { eventId: event.id }, select: { endpointId: true, generation: true } });
          const generation = Math.max(-1, ...existing.map(d => d.generation)) + 1;
          const ids = [...new Set(existing.map(d => d.endpointId))];
          await tx.delivery.createMany({ data: ids.map(endpointId => ({ eventId: event.id, endpointId, generation })) });
          return { eventId: event.id, generation, queued: ids.length };
        });
        return json(result, 202);
      }
      if (req.method === "GET" && path.length === 2) {
        const requested = url.searchParams.get("generation");
        const generation = requested === null ? (await db.delivery.aggregate({ where: { eventId: event.id }, _max: { generation: true } }))._max.generation ?? 0 : z.coerce.number().int().min(0).parse(requested);
        const deliveries = await db.delivery.findMany({ where: { eventId: event.id, generation }, include: { endpoint: { select: endpointFields } }, orderBy: { createdAt: "asc" } });
        const attempts = await db.deliveryAttempt.findMany({ where: { eventId: event.id, deliveryId: { in: deliveries.map(d => d.id) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { deliveryId: true, status: true, httpStatusCode: true, durationMs: true, error: true } });
        return json({ event, generation, deliveries: deliveries.map(d => ({ ...d, attempts: attempts.filter(a => a.deliveryId === d.id && a.status !== "SKIPPED_CIRCUIT_OPEN").length, lastAttempt: attempts.find(a => a.deliveryId === d.id) ?? null })) });
      }
    }
    throw new ApiFailure(404, "API route not found");
  } catch (error) {
    if (error instanceof ApiFailure) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "Invalid request parameters" }, 400);
    if (error instanceof Error && /public HTTPS|Private|URL/.test(error.message)) return json({ error: "Endpoint must use a public HTTPS URL on port 443" }, 400);
    console.error("CLI API request failed", { name: error instanceof Error ? error.name : "Unknown" });
    return json({ error: "Service temporarily unavailable" }, 503);
  }
}
