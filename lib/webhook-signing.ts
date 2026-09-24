import { createHmac } from "node:crypto";
import { decryptEndpointSecret, type SecretContext } from "./endpoint-secrets";
export type SigningEndpoint = SecretContext & { secret: string; signatureFormat: "STANDARD"; previousSecret: string | null; previousSecretVersion: number | null; previousSecretExpiresAt: Date | null };
export function displaySigningSecret(secret: string, _format: "STANDARD") {
  return "whsec_" + Buffer.from(secret, "utf8").toString("base64");
}
export function webhookHeaders(raw: string | Buffer, event: { id: string; idempotencyKey: string; type: string }, endpoint: SigningEndpoint, now = new Date()): Record<string, string> {
  const current = decryptEndpointSecret(endpoint.secret, endpoint);
  const previous = endpoint.previousSecret && endpoint.previousSecretVersion !== null && endpoint.previousSecretExpiresAt && endpoint.previousSecretExpiresAt > now
    ? decryptEndpointSecret(endpoint.previousSecret, { ...endpoint, secretVersion: endpoint.previousSecretVersion }) : null;
  const timestamp = Math.floor(now.getTime() / 1000);
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Idempotency-Key": event.idempotencyKey, "X-Webhook-Event": event.type, "X-Webhook-Endpoint": endpoint.id };
  // Event IDs are server-generated and contain no period. Never use an
  // untrusted producer key here: delimiter injection can create ambiguity.
  if (!/^[A-Za-z0-9_-]+$/.test(event.id)) throw new Error("Invalid webhook event ID");
  headers["webhook-id"] = event.id;
  headers["webhook-timestamp"] = String(timestamp);
  const signed = Buffer.concat([Buffer.from(`${event.id}.${timestamp}.`), Buffer.isBuffer(raw) ? raw : Buffer.from(raw)]);
  headers["webhook-signature"] = [current, ...(previous ? [previous] : [])].map(secret => "v1," + createHmac("sha256", secret).update(signed).digest("base64")).join(" ");
  return headers;
}
