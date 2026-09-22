import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("../../lib/security", async importOriginal => {
  const real = await importOriginal<typeof import("../../lib/security")>();
  return { ...real, resolveEndpoint: vi.fn(async (url: string) => { if (url.includes("169.254")) throw new Error("Private address"); return { url: new URL(url) }; }) };
});
import { db } from "../../lib/db";
import { createWorkspace } from "../../lib/workspaces";
import { enablePortal, portalRequest } from "../../lib/portal";
import { hashApiKey, encryptSecret } from "../../lib/secrets";
let userId: string, workspaceId: string, appId: string, token: string;
const request = (method = "GET", body?: unknown, cookie?: string, origin?: string) => new Request("https://example.com/api/portal/" + token, { method, headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
async function visitor() { const r = await portalRequest(request(), token); expect(r.status).toBe(200); return r.headers.get("set-cookie")!.split(";")[0]; }
async function endpoint(cookie: string) { const r = await portalRequest(request("POST", { url: "https://example.com/hook", eventTypes: ["*"] }, cookie), token); expect(r.status).toBe(201); return (await r.json()).id as string; }
beforeEach(async () => {
  vi.stubEnv("PORTAL_IP_LIMIT_PER_MINUTE", "1000");
  userId = (await db.user.create({ data: { email: randomUUID() + "@example.com", hashedPassword: "unused" } })).id;
  workspaceId = (await createWorkspace(userId, "Portal test")).id;
  appId = (await db.application.create({ data: { workspaceId, name: "Portal app", currentApiKey: hashApiKey(randomUUID()) } })).id;
  token = await enablePortal(appId, userId);
});
afterEach(async () => {
  await db.workspace.delete({ where: { id: workspaceId } });
  await db.user.deleteMany({ where: { email: { endsWith: "@portal-test.invalid" } } });
  await db.user.delete({ where: { id: userId } });
  await db.ipRateBucket.deleteMany({ where: { key: { startsWith: "portal:" } } });
  vi.unstubAllEnvs();
});
it("stores protected links and refuses member provisioning", async () => {
  const stored = await db.application.findUniqueOrThrow({ where: { id: appId } });
  expect(stored.portalTokenHash).toBe(hashApiKey(token));
  expect(stored.portalTokenEncrypted).not.toContain(token);
  expect(await enablePortal(appId, userId)).toBe(token);
  const member = await db.user.create({ data: { email: randomUUID() + "@portal-test.invalid", hashedPassword: "unused" } });
  await db.workspaceMember.create({ data: { workspaceId, userId: member.id, role: "MEMBER" } });
  await expect(enablePortal(appId, member.id)).rejects.toThrow();
});
it("isolates two guests, dashboard endpoints and delivery logs, including every mutation", async () => {
  const a = await visitor(), b = await visitor(); expect(a).not.toBe(b);
  const aid = await endpoint(a), bid = await endpoint(b);
  const privateEndpoint = await db.endpoint.create({ data: { applicationId: appId, url: "https://example.com/private", secret: encryptSecret("private", appId), eventTypes: ["*"] } });
  const event = await db.event.create({ data: { applicationId: appId, type: "order.test", idempotencyKey: randomUUID(), payload: {} } });
  for (const id of [aid, bid, privateEndpoint.id]) await db.deliveryAttempt.create({ data: { endpointId: id, eventId: event.id, deliveryId: randomUUID(), attemptNumber: 1, status: "SUCCESS" } });
  const visible = await (await portalRequest(request("GET", undefined, a), token)).json();
  expect(visible.endpoints.map((e: { id: string }) => e.id)).toEqual([aid]);
  expect(visible.attempts).toHaveLength(1); expect(visible.attempts[0].endpointId).toBe(aid);
  for (const id of [bid, privateEndpoint.id]) for (const method of ["PATCH", "DELETE"]) expect((await portalRequest(request(method, { endpointId: id, action: "pause" }, a), token)).status).toBe(404);
  for (const action of ["pause", "resume"]) expect((await portalRequest(request("PATCH", { endpointId: aid, action }, a), token)).status).toBe(200);
  expect((await db.endpoint.findUniqueOrThrow({ where: { id: aid } })).status).toBe("ACTIVE");
  expect((await portalRequest(request("DELETE", { endpointId: aid }, a), token)).status).toBe(200);
  expect(await db.endpoint.findUnique({ where: { id: aid } })).toBeNull();
  expect(await db.endpoint.findUnique({ where: { id: bid } })).not.toBeNull();
});
it("denies cross-application IDs even when a browser supplies the same guest credential", async () => {
  const cookie = await visitor(); const id = await endpoint(cookie);
  const other = await db.application.create({ data: { workspaceId, name: "Other", currentApiKey: hashApiKey(randomUUID()) } });
  const otherToken = await enablePortal(other.id, userId);
  const copied = cookie.replace(appId, other.id);
  expect((await portalRequest(request("PATCH", { endpointId: id, action: "pause" }, copied), otherToken)).status).toBe(404);
});
it("enforces SSRF, byte/depth limits, origin, cookie and token validation", async () => {
  const cookie = await visitor();
  expect((await portalRequest(request("POST", {}, undefined), token)).status).toBe(403);
  expect((await portalRequest(request("POST", {}, cookie, "https://attacker.example"), token)).status).toBe(403);
  expect((await portalRequest(request(), "invalid")).status).toBe(404);
  expect((await portalRequest(request(), "f".repeat(64))).status).toBe(404);
  expect((await portalRequest(request("POST", { url: "https://169.254.169.254", eventTypes: ["*"] }, cookie), token)).status).toBe(400);
  expect((await portalRequest(request("POST", { url: "x".repeat(9000) }, cookie), token)).status).toBe(413);
  const deep = new Request("https://example.com", { method: "POST", headers: { cookie }, body: "[".repeat(33) + "0" + "]".repeat(33) });
  expect((await portalRequest(deep, token)).status).toBe(400);
});
it("limits per-IP requests and bounds anonymous endpoint creation", async () => {
  const cookie = await visitor();
  for (let i=0;i<10;i++) await endpoint(cookie);
  expect((await portalRequest(request("POST", { url: "https://example.com", eventTypes: ["*"] }, cookie), token)).status).toBe(409);
  vi.stubEnv("PORTAL_IP_LIMIT_PER_MINUTE", "1");
  const r = await portalRequest(request(), token); expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBe("60");
});
