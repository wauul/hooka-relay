import { createHmac } from "node:crypto";
import { signature } from "./security";
import { decryptEndpointSecret, type SecretContext } from "./endpoint-secrets";
export type SigningEndpoint = SecretContext & { secret: string; signatureFormat: "LEGACY" | "STANDARD"; previousSecret: string | null; previousSecretVersion: number | null; previousSecretExpiresAt: Date | null };
// Legacy keys are UTF-8 strings. Base64 serializes the exact same bytes when a
// customer opts into Standard Webhooks; it does not silently rotate their key.
export function displaySigningSecret(secret: string, format: "LEGACY" | "STANDARD") {
  return format === "STANDARD" ? "whsec_" + Buffer.from(secret, "utf8").toString("base64") : secret;
}
export function webhookHeaders(raw: string, event: { id: string; idempotencyKey: string; type: string }, endpoint: SigningEndpoint, now = new Date()): Record<string, string> {
  const current = decryptEndpointSecret(endpoint.secret, endpoint);
  const previous = endpoint.previousSecret && endpoint.previousSecretVersion !== null && endpoint.previousSecretExpiresAt && endpoint.previousSecretExpiresAt > now
    ? decryptEndpointSecret(endpoint.previousSecret, { ...endpoint, secretVersion: endpoint.previousSecretVersion }) : null;
  const timestamp = Math.floor(now.getTime() / 1000);
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Idempotency-Key": event.idempotencyKey, "X-Webhook-Event": event.type, "X-Webhook-Endpoint": endpoint.id };
  if (endpoint.signatureFormat === "STANDARD") {
    // Event IDs are server-generated and contain no period. Never use an
    // untrusted producer key here: delimiter injection can create ambiguity.
    if (!/^[A-Za-z0-9_-]+$/.test(event.id)) throw new Error("Invalid webhook event ID");
    headers["webhook-id"] = event.id;
    headers["webhook-timestamp"] = String(timestamp);
    headers["webhook-signature"] = [current, ...(previous ? [previous] : [])].map(secret => "v1," + createHmac("sha256", secret).update(`${event.id}.${timestamp}.${raw}`).digest("base64")).join(" ");
  } else {
    // Keep old single-signature receivers working throughout their grace window.
    // Updated receivers can verify the current header with the newly issued key.
    headers["X-Webhook-Signature"] = signature(raw, previous || current, timestamp);
    if (previous) headers["X-Webhook-Signature-Current"] = signature(raw, current, timestamp);
  }
  return headers;
}
