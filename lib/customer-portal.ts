import { z } from "zod";
import { db } from "./db";
import { sameOrigin } from "./access";
import { boundedJson } from "./input-limits";
import { effectiveEndpointStatus } from "./endpoint-options";
import { newEndpointData } from "./endpoint-config";
import { revealSigningSecret } from "./signing-secrets";
import { replayEvent } from "./replay";
import { startRecovery } from "./recovery";
import { WorkspaceError } from "./workspaces";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const endpointInput = z.object({ url: z.string().url().max(2000), eventTypes: z.array(z.string().min(1).max(120).regex(/^(\*|[A-Za-z0-9_.:-]+)$/)).min(1).max(50) });
const endpointAction = z.object({ endpointId: z.string().min(1).max(100), action: z.enum(["pause", "resume"]).optional() });

export async function customerPortalRequest(req: Request, customer: { id: string; applicationId: string; name: string; application: { name: string } }) {
  const owned = { applicationId: customer.applicationId, customerId: customer.id };
  if (req.method === "GET") {
    const [endpoints, attempts, events, recoveries] = await Promise.all([
      db.endpoint.findMany({ where: { ...owned, kind: "BUSINESS" }, orderBy: { createdAt: "desc" } }),
      db.deliveryAttempt.findMany({ where: { endpoint: owned, event: owned }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, endpointId: true, eventId: true, status: true, httpStatusCode: true, attemptNumber: true, createdAt: true, event: { select: { type: true } } } }),
      db.event.findMany({ where: { ...owned, operational: false }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, type: true, createdAt: true } }),
      db.recoveryJob.findMany({ where: owned, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, queued: true, since: true, createdAt: true } }),
    ]);
    return json({ application: customer.application.name, customer: customer.name,
      endpoints: await Promise.all(endpoints.map(async endpoint => ({ id: endpoint.id, url: endpoint.url, eventTypes: endpoint.eventTypes, status: effectiveEndpointStatus(endpoint), userStatus: endpoint.status, circuitState: endpoint.circuitState, createdAt: endpoint.createdAt, secret: await revealSigningSecret(endpoint, `customer:${customer.id}`) }))),
      attempts, events, recoveries });
  }
  sameOrigin(req);
  const body = await boundedJson(req, 8192);
  if (req.method === "POST") {
    if (typeof body === "object" && body !== null && "action" in body && body.action === "replay") {
      const input = z.object({ action: z.literal("replay"), eventId: z.string().min(1).max(100), endpointId: z.string().min(1).max(100) }).parse(body);
      const event = await db.event.findFirst({ where: { id: input.eventId, ...owned, operational: false }, select: { id: true, type: true } });
      const endpoint = event && await db.endpoint.findFirst({ where: { id: input.endpointId, ...owned, kind: "BUSINESS", status: "ACTIVE", OR: [{ eventTypes: { has: "*" } }, { eventTypes: { has: event.type } }] }, select: { id: true } });
      if (!event || !endpoint) throw new WorkspaceError(404, "Event or endpoint not found");
      return json(await db.$transaction(tx => replayEvent(tx, event.id, [endpoint.id])), 202);
    }
    if (typeof body === "object" && body !== null && "action" in body && body.action === "recover") {
      const input = z.object({ action: z.literal("recover"), since: z.string().datetime(), endpointId: z.string().min(1).max(100).optional() }).parse(body);
      return json(await startRecovery(customer.applicationId, new Date(input.since), input.endpointId, customer.id), 202);
    }
    const input = endpointInput.parse(body);
    const data = await newEndpointData(customer.applicationId, input.url, input.eventTypes);
    const endpoint = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customer.id} AND "applicationId" = ${customer.applicationId} FOR UPDATE`;
      if (await tx.endpoint.count({ where: owned }) >= 10) throw new WorkspaceError(409, "Customer endpoint limit reached");
      return tx.endpoint.create({ data: { ...data, customerId: customer.id }, select: { id: true } });
    });
    return json(endpoint, 201);
  }
  const input = endpointAction.parse(body);
  if (req.method === "DELETE") {
    const result = await db.endpoint.deleteMany({ where: { id: input.endpointId, ...owned, kind: "BUSINESS" } });
    return result.count ? json({ ok: true }) : json({ error: "Endpoint not found" }, 404);
  }
  if (req.method === "PATCH" && input.action) {
    const result = await db.endpoint.updateMany({ where: { id: input.endpointId, ...owned, kind: "BUSINESS" }, data: { status: input.action === "pause" ? "PAUSED" : "ACTIVE" } });
    return result.count ? json({ ok: true }) : json({ error: "Endpoint not found" }, 404);
  }
  return json({ error: "Unsupported action" }, 400);
}
