import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decryptSecret } from "./secrets";
export type SecretContext = { id: string; applicationId: string; secretVersion: number };
function key(id: string) {
  if (!/^k[1-9][0-9]{0,3}$/.test(id)) throw new Error("Invalid signing encryption key version");
  const value = process.env[`ENDPOINT_SECRET_ENCRYPTION_KEY_${id.toUpperCase()}`] || (id === "k1" ? process.env.ENDPOINT_SECRET_ENCRYPTION_KEY : "");
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("Signing encryption key unavailable");
  return Buffer.from(value, "hex");
}
function aad(context: SecretContext, keyId: string) {
  if (!Number.isSafeInteger(context.secretVersion) || context.secretVersion < 0) throw new Error("Invalid secret version");
  return Buffer.from(JSON.stringify(["hooka-signing", 2, keyId, context.applicationId, context.id, context.secretVersion]));
}
export function encryptEndpointSecret(secret: string, context: SecretContext) {
  const keyId = process.env.ENDPOINT_SECRET_KEY_ID || "k1", iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyId), iv);
  cipher.setAAD(aad(context, keyId));
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["enc", "v2", keyId, iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}
export function decryptEndpointSecret(value: string, context: SecretContext) {
  // Explicit version 0 is a rollout-only legacy row. Migrated/new rows never
  // accept v1 ciphertext, so swapping secrets between endpoints fails closed.
  if (context.secretVersion === 0 && value.startsWith("enc:v1:")) return decryptSecret(value, context.applicationId);
  const match = /^enc:v2:(k[1-9][0-9]{0,3}):([a-f0-9]{24}):([a-f0-9]{32}):((?:[a-f0-9]{2})+)$/.exec(value);
  if (!match) throw new Error("Invalid endpoint-bound signing secret");
  const decipher = createDecipheriv("aes-256-gcm", key(match[1]), Buffer.from(match[2], "hex"));
  decipher.setAAD(aad(context, match[1])); decipher.setAuthTag(Buffer.from(match[3], "hex"));
  return Buffer.concat([decipher.update(Buffer.from(match[4], "hex")), decipher.final()]).toString("utf8");
}
