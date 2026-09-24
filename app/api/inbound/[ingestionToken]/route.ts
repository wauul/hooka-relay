import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { admitEvent } from "@/lib/rate-limit";
import { checkJsonDepth } from "@/lib/input-limits";
import { ingest } from "@/lib/events";
import { manualVerifierSchema, providers } from "@/lib/webhook-providers";
import { publishInboundLive } from "@/lib/queue/client";

export const maxDuration = 30;
type Context = { params: Promise<{ ingestionToken: string }> };
async function boundedRaw(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 262144) throw new Error("body_limit");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("empty_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) { await reader.cancel(); throw new Error("body_limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function POST(req: Request, { params }: Context) {
  const token = (await params).ingestionToken;
  if (!/^[a-f0-9]{64}$/.test(token)) return Response.json({ error: "Webhook rejected" }, { status: 404 });
  try {
    const limited = await ipRateLimit(req, "events");
    if (limited) return limited;
    const source = await db.webhookSource.findUnique({ where: { ingestionToken: token } });
    if (!source) return Response.json({ error: "Webhook rejected" }, { status: 404 });
    if (source.status === "PAUSED") return Response.json({ error: "Webhook unavailable" }, { status: 503 });
    if (!source.encryptedProviderSecret) return Response.json({ error: "Webhook unavailable" }, { status: 503 });
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("application/json") && !contentType.startsWith("application/x-www-form-urlencoded")) return Response.json({ error: "Webhook rejected" }, { status: 415 });
    const rawBody = await boundedRaw(req);
    const rawHeaders = Object.fromEntries(req.headers.entries());
    const publicUrl = new URL(req.url);
    publicUrl.protocol = new URL(process.env.NEXTAUTH_URL || req.url).protocol;
    publicUrl.host = new URL(process.env.NEXTAUTH_URL || req.url).host;
    const secret = decryptSecret(source.encryptedProviderSecret, source.applicationId);
    const adapter = providers[source.provider];
    const manualConfig = source.provider === "CUSTOM" && source.manualConfig ? manualVerifierSchema.parse(source.manualConfig) : undefined;
    if (!adapter.verifySignature({ rawBody, headers: req.headers, secret, url: publicUrl.toString(), manualConfig })) {
      await db.webhookSource.update({ where: { id: source.id }, data: { lastVerificationFailure: "Provider signature missing or invalid", lastVerificationFailureAt: new Date() } });
      // Public responses stay generic; only authenticated source views expose
      // this reason and the captured request for debugging.
      await db.inboundReceipt.create({ data: { sourceId: source.id, provider: source.provider, rawBody: rawBody.toString("base64"), searchText: rawBody.toString("utf8"), rawHeaders, verified: false, failureReason: "Provider signature missing or invalid" } });
      return Response.json({ error: "Webhook rejected" }, { status: 401 });
    }
    let payload: unknown;
    if (contentType.startsWith("application/json")) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
      checkJsonDepth(text);
      payload = JSON.parse(text);
    } else {
      const entries = new URLSearchParams(rawBody.toString("utf8"));
      payload = Object.fromEntries(entries);
    }
    if (source.provider === "ZOOM" && payload && typeof payload === "object" && (payload as Record<string, unknown>).event === "endpoint.url_validation") {
      const plainToken = ((payload as Record<string, unknown>).payload as Record<string, unknown> | undefined)?.plainToken;
      if (typeof plainToken !== "string" || plainToken.length > 512) return Response.json({ error: "Webhook rejected" }, { status: 400 });
      return Response.json({ plainToken, encryptedToken: createHmac("sha256", secret).update(plainToken).digest("hex") });
    }
    const providerId = adapter.eventId(payload, req.headers);
    const digest = createHash("sha256").update(providerId || rawBody).digest("hex");
    const type = adapter.eventType(payload, req.headers).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120);
    const retryAfter = await admitEvent(source.applicationId);
    if (retryAfter) return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    const event = await ingest(source.applicationId, {
      type,
      idempotencyKey: `inbound:${source.id}:${digest}`,
      payload: { provider: source.provider, sourceId: source.id, providerEventId: providerId, data: payload },
    }, { endpointId: source.destinationUrl && source.endpointId ? source.endpointId : undefined, webhookSourceId: source.id });
    const receipt = await db.inboundReceipt.upsert({ where: { eventId: event.id }, create: {
      sourceId: source.id, eventId: event.id, provider: source.provider, eventType: type,
      rawBody: rawBody.toString("base64"), searchText: rawBody.toString("utf8"), rawHeaders, verified: true,
    }, update: {} });
    await db.webhookSource.update({ where: { id: source.id }, data: { lastEventReceivedAt: new Date(), lastVerifiedAt: new Date(), lastVerificationFailure: null, lastVerificationFailureAt: null } });
    await publishInboundLive(source.id, receipt.id).catch(() => console.warn("Live forwarding unavailable; durable event delivery continues"));
    // Slack's URL verification challenge must be returned after signature validation.
    if (source.provider === "SLACK" && payload && typeof payload === "object" && (payload as Record<string, unknown>).type === "url_verification") {
      const challenge = (payload as Record<string, unknown>).challenge;
      if (typeof challenge === "string") return Response.json({ challenge });
    }
    return Response.json({ id: event.id }, { status: 202 });
  } catch (error) {
    console.error("Inbound webhook processing failed", { name: error instanceof Error ? error.name : "Unknown" });
    return Response.json({ error: "Webhook rejected" }, { status: error instanceof Error && (error.message === "body_limit") ? 413 : 400 });
  }
}
export async function GET(req: Request, { params }: Context) {
  const token = (await params).ingestionToken;
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response(null, { status: 404 });
  const source = await db.webhookSource.findUnique({ where: { ingestionToken: token } });
  if (!source?.encryptedProviderSecret) return new Response(null, { status: 404 });
  const url = new URL(req.url);
  if (["FACEBOOK", "INSTAGRAM", "WHATSAPP"].includes(source.provider)) {
    const mode = url.searchParams.get("hub.mode"), supplied = url.searchParams.get("hub.verify_token"), challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || !supplied || !challenge || supplied.length > 256 || challenge.length > 512 || !source.verificationTokenHash) return new Response(null, { status: 403 });
    const actual = createHash("sha256").update(supplied).digest();
    const expected = Buffer.from(source.verificationTokenHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } }) : new Response(null, { status: 403 });
  }
  if (source.provider === "LINKEDIN") {
    const challengeCode = url.searchParams.get("challengeCode");
    if (!challengeCode || challengeCode.length > 512) return new Response(null, { status: 403 });
    const secret = decryptSecret(source.encryptedProviderSecret, source.applicationId);
    return Response.json({ challengeCode, challengeResponse: createHmac("sha256", secret).update(challengeCode).digest("hex") });
  }
  return new Response(null, { status: 405 });
}
