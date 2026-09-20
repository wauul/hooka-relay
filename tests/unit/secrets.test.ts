import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret, hashApiKey, encryptionKey } from "../../lib/secrets";
afterEach(() => vi.unstubAllEnvs());
it("stores a SHA-256 digest and does not treat a digest as a usable key", () => {
  expect(hashApiKey("hr_live_test")).toBe("sha256:" + createHash("sha256").update("hr_live_test").digest("hex"));
  expect(hashApiKey(hashApiKey("hr_live_test"))).not.toBe(hashApiKey("hr_live_test"));
});
it("encrypts with a fresh nonce and round-trips the signing secret", () => {
  const value = encryptSecret("original-secret", "app");
  expect(value).not.toContain("original-secret");
  expect(encryptSecret("original-secret", "app")).not.toBe(value);
  expect(decryptSecret(value, "app")).toBe("original-secret");
});
it("rejects tampering, wrong tenant, wrong key and legacy plaintext", () => {
  const value = encryptSecret("original-secret", "app");
  const last = value.endsWith("0") ? "1" : "0";
  expect(() => decryptSecret(value.slice(0, -1) + last, "app")).toThrow();
  expect(() => decryptSecret(value, "other")).toThrow();
  expect(() => decryptSecret("plaintext", "app")).toThrow();
  vi.stubEnv("ENDPOINT_SECRET_ENCRYPTION_KEY", "22".repeat(32));
  expect(() => decryptSecret(value, "app")).toThrow();
});
it.each(["", "short", "zz".repeat(32)])("rejects missing/malformed encryption key %s", (key) => {
  vi.stubEnv("ENDPOINT_SECRET_ENCRYPTION_KEY", key);
  expect(() => encryptionKey()).toThrow();
});
