import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { admitEvent } from "@/lib/rate-limit";
import { checkJsonDepth } from "@/lib/input-limits";
import { ingest } from "@/lib/events";
import { manualVerifierSchema, providers } from "@/lib/webhook-providers";

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
    if (!source.encryptedProviderSecret || !source.endpointId || !source.destinationUrl) return Response.json({ error: "Webhook unavailable" }, { status: 503 });
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.startsWith("application/json") && !contentType.startsWith("application/x-www-form-urlencoded")) return Response.json({ error: "Webhook rejected" }, { status: 415 });
    const rawBody = await boundedRaw(req);
    const publicUrl = new URL(req.url);
    publicUrl.protocol = new URL(process.env.NEXTAUTH_URL || req.url).protocol;
    publicUrl.host = new URL(process.env.NEXTAUTH_URL || req.url).host;
    const secret = decryptSecret(source.encryptedProviderSecret, source.applicationId);
    const adapter = providers[source.provider];
    const manualConfig = source.provider === "CUSTOM" && source.manualConfig ? manualVerifierSchema.parse(source.manualConfig) : undefined;
    if (!adapter.verifySignature({ rawBody, headers: req.headers, secret, url: publicUrl.toString(), manualConfig })) {
      await db.webhookSource.update({ where: { id: source.id }, data: { lastVerificationFailure: "Provider signature missing or invalid", lastVerificationFailureAt: new Date() } });
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
    const providerId = adapter.eventId(payload, req.headers);
    const digest = createHash("sha256").update(providerId || rawBody).digest("hex");
    const type = adapter.eventType(payload, req.headers).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120);
    const retryAfter = await admitEvent(source.applicationId);
    if (retryAfter) return Response.json({ error: "Rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    const event = await ingest(source.applicationId, {
      type,
      idempotencyKey: `inbound:${source.id}:${digest}`,
      payload: { provider: source.provider, sourceId: source.id, providerEventId: providerId, data: payload },
    }, { endpointId: source.endpointId, webhookSourceId: source.id });
    await db.webhookSource.update({ where: { id: source.id }, data: { lastEventReceivedAt: new Date(), lastVerifiedAt: new Date(), lastVerificationFailure: null, lastVerificationFailureAt: null } });
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
