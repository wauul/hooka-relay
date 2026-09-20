import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Random 256-bit API keys need a one-way digest, not a reversible ciphertext.
// A stolen database must not yield bearer credentials usable against the API.
export const hashApiKey = (key: string) => "sha256:" + createHash("sha256").update(key).digest("hex");
export const isHashedKey = (key: string) => /^sha256:[a-f0-9]{64}$/.test(key);
export function encryptionKey() {
  const value = process.env.ENDPOINT_SECRET_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("ENDPOINT_SECRET_ENCRYPTION_KEY must be 32 bytes encoded as hex");
  return Buffer.from(value, "hex");
}
export function encryptSecret(secret: string, applicationId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  // Bind ciphertext to its tenant so copying a row across applications fails.
  cipher.setAAD(Buffer.from("hooka-endpoint-v1:" + applicationId));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["enc", "v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), ciphertext.toString("hex")].join(":");
}
export function decryptSecret(value: string, applicationId: string) {
  const match = /^enc:v1:([a-f0-9]{24}):([a-f0-9]{32}):((?:[a-f0-9]{2})+)$/.exec(value);
  // No plaintext fallback: an incomplete migration must fail closed.
  if (!match) throw new Error("Invalid encrypted endpoint secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(match[1], "hex"));
  decipher.setAAD(Buffer.from("hooka-endpoint-v1:" + applicationId));
  decipher.setAuthTag(Buffer.from(match[2], "hex"));
  return Buffer.concat([decipher.update(Buffer.from(match[3], "hex")), decipher.final()]).toString("utf8");
}
