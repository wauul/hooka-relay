import { eventBacklog } from "./event-backlog";
import { startRecovery } from "./recovery";
import { catalogInput, listEventTypes, publishEventType } from "./event-catalog";
import { endpointOptions, endpointOptionData, effectiveEndpointStatus } from "./endpoint-options";
import { replayEvent } from "./replay";
import { hashApiKey } from "./secrets";
import { newEndpointData } from "./endpoint-config";
import { InputLimitError, boundedJson } from "./input-limits";
import { WorkspaceError } from "./workspaces";
import { rotateSigningSecret } from "./signing-secrets";
import { revealSigningSecret } from "./signing-secrets";
import { applicationForKey } from "./api-keys";
import { z } from "zod";
import { db } from "./db";


const endpointFields = { id: true, url: true, eventTypes: true, circuitState: true, status: true, environment: true, kind: true, deliveryRatePerMinute: true, signatureFormat: true, createdAt: true } as const;
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
    const authenticated = await applicationForKey(key, req.method === "GET" ? "READ" : "MANAGE");
    const app = authenticated ? { id: authenticated.id, name: authenticated.name, createdAt: authenticated.createdAt } : null;
    if (!app) throw new ApiFailure(401, "Invalid API key");
    const url = new URL(req.url);
    const route = path.join("/");
    if (path[0] === "applications" && path.length === 3) {
      if (path[1] !== app.id) throw new ApiFailure(404, "Application not found");
      if (path[2] === "events" && req.method === "GET") return json(await eventBacklog(app.id, url));
      if (path[2] === "event-types" && req.method === "GET") return json(await listEventTypes(app.id));
      if (path[2] === "event-types" && req.method === "POST") { const input = catalogInput.parse(await boundedJson(req, 20000)); return json(await db.$transaction(tx => publishEventType(tx, app.id, input)), 201); }
      if (path[2] === "recovery" && req.method === "GET") return json(await db.recoveryJob.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" }, take: 20 }));
      if (path[2] === "recovery" && req.method === "POST") {
        const input = z.object({ since: z.string().datetime(), endpointId: z.string().min(1).optional() }).parse(await boundedJson(req, 1024));
        return json(await startRecovery(app.id, new Date(input.since), input.endpointId), 202);
      }
    }
    if (path[0] === "endpoints" && path[1] && path.length === 3 && req.method === "PATCH" && ["pause", "resume", "configuration"].includes(path[2])) {
      const endpoint = await db.endpoint.findFirst({ where: { id: path[1], applicationId: app.id } });
      if (!endpoint || endpoint.kind === "INBOUND") throw new ApiFailure(404, "Endpoint not found");
      const data = path[2] === "configuration" ? endpointOptionData(endpoint, endpointOptions.parse(await boundedJson(req, 16384))) : { status: path[2] === "pause" ? "PAUSED" as const : "ACTIVE" as const };
      const updated = await db.endpoint.update({ where: { id: endpoint.id }, data });
      return json({ id: updated.id, status: effectiveEndpointStatus(updated), environment: updated.environment });
    }
    if (req.method === "GET" && route === "me") return json({ application: app });
    if (route === "endpoints" && req.method === "GET") {
      const endpoints = await db.endpoint.findMany({ where: { applicationId: app.id, kind: { not: "INBOUND" } }, select: endpointFields, orderBy: { createdAt: "asc" } });
      const counts = await db.deliveryAttempt.groupBy({
        by: ["endpointId", "status"],
        where: { endpoint: { applicationId: app.id }, createdAt: { gte: new Date(Date.now() - 86400000) }, status: { not: "SKIPPED_CIRCUIT_OPEN" } },
        _count: { _all: true },
      });
      return json({ endpoints: endpoints.map(ep => {
        const rows = counts.filter(c => c.endpointId === ep.id);
        const total = rows.reduce((n, c) => n + c._count._all, 0);
        const success = rows.find(c => c.status === "SUCCESS")?._count._all || 0;
        return { ...ep, userStatus: ep.status, status: effectiveEndpointStatus(ep), successRate: total ? Math.round(success * 100 / total) : null };
      }) });
    }
    if (route === "endpoints" && req.method === "POST") {
      const body = await req.text();
      if (Buffer.byteLength(body) > 16384) throw new ApiFailure(413, "Endpoint request is too large");
      const parsed = JSON.parse(body);
      const input = z.object({ url: z.string().url().max(2000), eventTypes: z.array(z.string().min(1).max(120).regex(/^(\*|[A-Za-z0-9_.:-]+)$/)).min(1).max(50).default(["*"]) }).parse(parsed);
      const data = await newEndpointData(app.id, input.url, input.eventTypes);
      const endpoint = await db.endpoint.create({ data: { ...data, ...endpointOptionData(data, endpointOptions.parse(parsed)) } });
      const secret = await revealSigningSecret(endpoint, "api-key:" + hashApiKey(key));
      return json({ endpoint: { id: endpoint.id, url: endpoint.url, eventTypes: endpoint.eventTypes, signatureFormat: endpoint.signatureFormat, environment: endpoint.environment, status: effectiveEndpointStatus(endpoint), secret } }, 201);
    }
    if (path[0] === "endpoints" && path[1] && path.length === 3 && ["rotate-secret", "signature-format"].includes(path[2])) {
      const ep = await db.endpoint.findFirst({ where: { id: path[1], applicationId: app.id } });
      if (!ep || ep.kind === "INBOUND") throw new ApiFailure(404, "Endpoint not found");
      const actor = "api-key:" + hashApiKey(key);
      if (req.method === "POST" && path[2] === "rotate-secret") return json(await db.$transaction(tx => rotateSigningSecret(tx, ep.id, actor)));
      if (req.method === "PATCH" && path[2] === "signature-format") {
        const { signatureFormat } = z.object({ signatureFormat: z.enum(["LEGACY", "STANDARD"]) }).parse(await boundedJson(req, 1024));
        await db.$transaction([db.endpoint.update({ where: { id: ep.id }, data: { signatureFormat } }), db.auditLog.create({ data: { applicationId: app.id, endpointId: ep.id, actorId: actor, action: "signature_format." + signatureFormat.toLowerCase(), secretVersion: ep.secretVersion } })]);
        return json({ signatureFormat });
      }
    }
    if (route === "attempts" && req.method === "GET") {
      const endpointId = url.searchParams.get("endpoint") || undefined;
      if (endpointId && !await db.endpoint.findFirst({ where: { id: endpointId, applicationId: app.id }, select: { id: true } })) throw new ApiFailure(404, "Endpoint not found");
      const raw = url.searchParams.get("after");
      const after = raw ? cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString())) : null;
      const attempts = await db.deliveryAttempt.findMany({
        where: { endpoint: { applicationId: app.id }, endpointId, ...(after ? { OR: [{ createdAt: { gt: new Date(after.time) } }, { createdAt: new Date(after.time), id: { gt: after.id } }] } : {}) },
        orderBy: after ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }], take: 101,
        select: { id: true, eventId: true, endpointId: true, deliveryId: true, attemptNumber: true, status: true, httpStatusCode: true, durationMs: true, createdAt: true, event: { select: { type: true } }, endpoint: { select: { url: true, status: true, environment: true, circuitState: true } } },
      });
      const hasMore = !!after && attempts.length > 100;
      const page = attempts.slice(0, 100);
      if (!after) page.reverse();
      return json({ attempts: page.map(a => ({ ...a, endpoint: { ...a.endpoint, status: effectiveEndpointStatus(a.endpoint) } })), nextCursor: page.length ? cursor(page[page.length - 1]) : raw, hasMore });
    }
    if (path[0] === "events" && path[1] && (path.length === 2 || (path.length === 3 && path[2] === "replay"))) {
      const event = await db.event.findFirst({ where: { id: path[1], applicationId: app.id } });
      if (!event) throw new ApiFailure(404, "Event not found");
      if (req.method === "POST" && path[2] === "replay") {
        const raw = await req.text();
        const { endpointId: requestedEndpoint } = z.object({ endpointId: z.string().min(1).optional() }).parse(raw ? JSON.parse(raw) : {});
        if (requestedEndpoint && !await db.endpoint.findFirst({ where: { id: requestedEndpoint, applicationId: app.id, kind: event.operational ? "OPERATIONAL" : "BUSINESS", status: "ACTIVE", OR: [{ eventTypes: { has: "*" } }, { eventTypes: { has: event.type } }] } })) throw new ApiFailure(404, "Active matching endpoint not found");
        // Same row lock and durable-outbox semantics as dashboard replay.
        const result = await db.$transaction(tx => replayEvent(tx, event.id, requestedEndpoint ? [requestedEndpoint] : undefined));
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
    if (error instanceof InputLimitError) return json({ error: error.message }, error.status);
    if (error instanceof WorkspaceError) return json({ error: error.message }, error.status);
    if (error instanceof ApiFailure) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "Invalid request parameters" }, 400);
    if (error instanceof Error && /public HTTPS|Private|URL/.test(error.message)) return json({ error: "Endpoint must use a public HTTPS URL on port 443" }, 400);
    console.error("CLI API request failed", { name: error instanceof Error ? error.name : "Unknown" });
    return json({ error: "Service temporarily unavailable" }, 503);
  }
}
