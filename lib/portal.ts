import { effectiveEndpointStatus } from "./endpoint-options";
import { z } from "zod";
import { db } from "./db";
import { sameOrigin, apiError } from "./access";
import { boundedJson } from "./input-limits";
import { ipRateLimit } from "./ip-rate-limit";
import { newSecret } from "./security";
import { newEndpointData } from "./endpoint-config";
import { revealSigningSecret } from "./signing-secrets";
import { decryptSecret, encryptSecret, hashApiKey } from "./secrets";
import { workspaceTransaction } from "./workspaces";
import { customerPortalRequest } from "./customer-portal";

export async function enablePortal(applicationId: string, userId: string) {
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
  if (app.customerMode !== "LEGACY") throw new Error("NOT_FOUND");
  return workspaceTransaction(app.workspaceId, userId, "manage", async tx => {
    await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${app.id} FOR UPDATE`;
    const fresh = await tx.application.findUniqueOrThrow({ where: { id: app.id } });
    if (fresh.portalTokenEncrypted) return decryptSecret(fresh.portalTokenEncrypted, app.id);
    const token = newSecret();
    await tx.application.update({ where: { id: app.id }, data: { portalTokenHash: hashApiKey(token), portalTokenEncrypted: encryptSecret(token, app.id) } });
    return token;
  });
}
const json = (data: unknown, status = 200, cookie?: string) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
export async function portalRequest(req: Request, token: string) {
  try {
    const limited = await ipRateLimit(req, "portal");
    if (limited) return limited;
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "Portal not found" }, 404);
    const customer = await db.customer.findUnique({ where: { portalTokenHash: hashApiKey(token) }, select: { id: true, applicationId: true, name: true, application: { select: { name: true, customerMode: true } } } });
    if (customer) {
      if (customer.application.customerMode !== "ISOLATED") return json({ error: "Portal not found" }, 404);
      return await customerPortalRequest(req, customer);
    }
    const app = await db.application.findUnique({ where: { portalTokenHash: hashApiKey(token) }, select: { id: true, name: true } });
    if (!app) return json({ error: "Portal not found" }, 404);
    if ((await db.application.findUnique({ where: { id: app.id }, select: { customerMode: true } }))?.customerMode !== "LEGACY") return json({ error: "Portal not found" }, 404);
    const secure = new URL(req.url).protocol === "https:";
    const cookieName = (secure ? "__Host-" : "") + "hr_portal_" + app.id;
    const existing = (req.headers.get("cookie") || "").split(";").map(p => p.trim()).find(p => p.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
    const validCookie = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : null;
    if (req.method !== "GET") {
      sameOrigin(req);
      if (!validCookie) return json({ error: "Open the portal first to establish your private browser access." }, 403);
    }
    const guest = validCookie || newSecret();
    // The link permits registration, not ownership of every visitor's resources.
    // Possession of a separate HttpOnly 256-bit cookie proves guest ownership.
    const owner = hashApiKey("portal:" + app.id + ":" + guest);
    const owned = { applicationId: app.id, portalOwnerHash: owner };
    if (req.method === "GET") {
      const endpoints = await db.endpoint.findMany({ where: owned, orderBy: { createdAt: "desc" } });
      const attempts = await db.deliveryAttempt.findMany({ where: { endpoint: owned }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, endpointId: true, status: true, httpStatusCode: true, attemptNumber: true, createdAt: true, event: { select: { type: true } } } });
      return json({ application: app.name, endpoints: await Promise.all(endpoints.map(async e => ({ id: e.id, url: e.url, eventTypes: e.eventTypes, status: effectiveEndpointStatus(e), userStatus: e.status, circuitState: e.circuitState, signatureFormat: e.signatureFormat, createdAt: e.createdAt, secret: await revealSigningSecret(e, "portal:" + owner) }))), attempts }, 200, validCookie ? undefined : `${cookieName}=${guest}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure ? "; Secure" : ""}`);
    }
    const body = await boundedJson(req, 8192);
    if (req.method === "POST") {
      const input = z.object({ url: z.string().url().max(2000), eventTypes: z.array(z.string().min(1).max(120).regex(/^(\*|[A-Za-z0-9_.:-]+)$/)).min(1).max(50) }).parse(body);
      const data = await newEndpointData(app.id, input.url, input.eventTypes);
      const endpoint = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${app.id} FOR UPDATE`;
        const count = await tx.endpoint.count({ where: { applicationId: app.id, portalOwnerHash: { not: null } } });
        const ownCount = await tx.endpoint.count({ where: owned });
        if (ownCount >= 10 || count >= 50) throw new Error("PORTAL_QUOTA");
        return tx.endpoint.create({ data: { ...owned, ...data }, select: { id: true } });
      });
      return json(endpoint, 201);
    }
    const input = z.object({ endpointId: z.string().min(1).max(100), action: z.enum(["pause", "resume"]).optional() }).parse(body);
    // Filter ownership inside the mutation, never trust a client endpoint ID.
    if (req.method === "DELETE") {
      const result = await db.endpoint.deleteMany({ where: { id: input.endpointId, ...owned } });
      return result.count ? json({ ok: true }) : json({ error: "Endpoint not found" }, 404);
    }
    if (req.method === "PATCH" && input.action) {
      const result = await db.endpoint.updateMany({ where: { id: input.endpointId, ...owned }, data: { status: input.action === "pause" ? "PAUSED" : "ACTIVE" } });
      return result.count ? json({ ok: true }) : json({ error: "Endpoint not found" }, 404);
    }
    return json({ error: "Unsupported action" }, 400);
  } catch (e) {
    if (e instanceof Error && e.message === "PORTAL_QUOTA") return json({ error: "Portal endpoint limit reached. Contact the application owner." }, 409);
    return apiError(e);
  }
}
