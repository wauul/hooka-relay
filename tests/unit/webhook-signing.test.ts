import { afterEach, expect, it, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { encryptSecret } from "../../lib/secrets";
import { decryptEndpointSecret, encryptEndpointSecret } from "../../lib/endpoint-secrets";
import { displaySigningSecret, webhookHeaders, type SigningEndpoint } from "../../lib/webhook-signing";
import { verifySignature } from "../../lib/security";
const context = { id: "endpoint1", applicationId: "app1", secretVersion: 1 };
const now = new Date("2026-09-22T12:00:00Z"), raw = '{"hello":"world"}';
const event = { id: "event1", idempotencyKey: "producer.key", type: "test" };
function endpoint(format: "LEGACY" | "STANDARD" = "STANDARD"): SigningEndpoint {
  return { ...context, secret: encryptEndpointSecret("current", context), signatureFormat: format,
    previousSecret: encryptEndpointSecret("previous", { ...context, secretVersion: 0 }), previousSecretVersion: 0,
    previousSecretExpiresAt: new Date(now.getTime() + 1000) };
}
afterEach(() => vi.useRealTimers());
it("binds ciphertext to endpoint, application, secret version and encryption key version", () => {
  const encrypted = encryptEndpointSecret("secret", context);
  expect(encrypted).toMatch(/^enc:v2:k1:/);
  expect(decryptEndpointSecret(encrypted, context)).toBe("secret");
  for (const changed of [{ ...context, id: "endpoint2" }, { ...context, applicationId: "app2" }, { ...context, secretVersion: 2 }])
    expect(() => decryptEndpointSecret(encrypted, changed)).toThrow();
  expect(() => decryptEndpointSecret(encrypted.replace(":k1:", ":k2:"), context)).toThrow();
  expect(() => decryptEndpointSecret(encrypted.slice(0, -2) + (encrypted.endsWith("00") ? "ff" : "00"), context)).toThrow();
});
it("accepts application-bound ciphertext only for explicit unmigrated rows", () => {
  const old = encryptSecret("unchanged", context.applicationId);
  expect(decryptEndpointSecret(old, { ...context, secretVersion: 0 })).toBe("unchanged");
  expect(() => decryptEndpointSecret(old, context)).toThrow();
});
it("passes the independent Standard Webhooks verifier with either grace-period key", () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const headers = webhookHeaders(raw, event, endpoint(), now);
  for (const secret of ["current", "previous"]) expect(new Webhook(displaySigningSecret(secret, "STANDARD")).verify(raw, headers)).toEqual(JSON.parse(raw));
  const verifier = new Webhook(displaySigningSecret("current", "STANDARD"));
  for (const [header, value] of [["webhook-id", "forged"], ["webhook-timestamp", String(Number(headers["webhook-timestamp"]) + 1)], ["webhook-signature", "v1,invalid"]]) expect(() => verifier.verify(raw, { ...headers, [header]: value })).toThrow();
  expect(() => verifier.verify(raw + " ", headers)).toThrow();
  expect(webhookHeaders(raw, event, endpoint(), new Date(now.getTime() + 500))["webhook-id"]).toBe(event.id);
  expect(() => webhookHeaders(raw, { ...event, id: "a.b" }, endpoint(), now)).toThrow();
  vi.setSystemTime(new Date(now.getTime() + 301000));
  expect(() => verifier.verify(raw, headers)).toThrow();
});
it("stops signing with the previous key exactly at expiry", () => {
  const ep = endpoint(), expiry = ep.previousSecretExpiresAt!;
  vi.useFakeTimers(); vi.setSystemTime(expiry);
  const headers = webhookHeaders(raw, event, ep, expiry);
  expect(new Webhook(displaySigningSecret("current", "STANDARD")).verify(raw, headers)).toEqual(JSON.parse(raw));
  expect(() => new Webhook(displaySigningSecret("previous", "STANDARD")).verify(raw, headers)).toThrow();
});
it("preserves legacy single-header receivers during rotation and signs with the new key after expiry", () => {
  const ep = endpoint("LEGACY"), headers = webhookHeaders(raw, event, ep, now);
  expect(verifySignature(raw, headers["X-Webhook-Signature"], "previous", now.getTime())).toBe(true);
  expect(verifySignature(raw, headers["X-Webhook-Signature-Current"], "current", now.getTime())).toBe(true);
  const after = webhookHeaders(raw, event, ep, ep.previousSecretExpiresAt!);
  expect(verifySignature(raw, after["X-Webhook-Signature"], "current", ep.previousSecretExpiresAt!.getTime())).toBe(true);
  expect(after).not.toHaveProperty("X-Webhook-Signature-Current");
});
