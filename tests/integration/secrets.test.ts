import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import { createWorkspace } from "../../lib/workspaces";
import { migrateSecrets } from "../../lib/migrate-secrets";
import { applicationForKey, rotateKey } from "../../lib/api-keys";
import { decryptSecret, encryptSecret, hashApiKey } from "../../lib/secrets";
import { signature, verifySignature } from "../../lib/security";
let userId: string, workspaceId: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (workspaceId) await db.workspace.delete({ where: { id: workspaceId } });
  if (userId) await db.user.delete({ where: { id: userId } });
});
async function fixture() {
  userId = (await db.user.create({ data: { email: randomUUID() + "@example.com", hashedPassword: "unused" } })).id;
  workspaceId = (await createWorkspace(userId, "Legacy workspace")).id;
  const current = "hr_live_" + randomUUID(), previous = "hr_live_" + randomUUID();
  const app = await db.application.create({ data: { workspaceId, name: "Legacy", currentApiKey: current, previousApiKey: previous, previousApiKeyExpiresAt: new Date(Date.now() + 60000) } });
  const endpoint = await db.endpoint.create({ data: { applicationId: app.id, url: "https://example.com", secret: "original-signing-secret", eventTypes: ["*"] } });
  return { app, endpoint, current, previous };
}
it("migrates existing credentials atomically, preserves auth/grace/signing, and is idempotent", async () => {
  const { app, endpoint, current, previous } = await fixture();
  const result = await migrateSecrets(db);
  expect(result.applications).toBeGreaterThan(0);
  expect(result.endpoints).toBeGreaterThan(0);
  const stored = await db.application.findUniqueOrThrow({ where: { id: app.id } });
  expect(stored.currentApiKey).toBe(hashApiKey(current));
  expect(stored.previousApiKeyExpiresAt).toEqual(app.previousApiKeyExpiresAt);
  expect((await applicationForKey(current))?.id).toBe(app.id);
  expect((await applicationForKey(previous))?.id).toBe(app.id);
  expect(await applicationForKey(stored.currentApiKey)).toBeNull();
  expect(await applicationForKey("a".repeat(257))).toBeNull();
  const encrypted = (await db.endpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).secret;
  expect(encrypted).not.toContain(endpoint.secret);
  const secret = decryptSecret(encrypted, app.id);
  expect(verifySignature("{}", signature("{}", secret), endpoint.secret)).toBe(true);
  expect(await migrateSecrets(db)).toEqual({ applications: 0, endpoints: 0 });
  await db.application.update({ where: { id: app.id }, data: { previousApiKeyExpiresAt: new Date(0) } });
  expect(await applicationForKey(previous)).toBeNull();
  const rotated = await rotateKey(app.id, userId);
  expect((await applicationForKey(rotated.currentApiKey))?.id).toBe(app.id);
  expect((await applicationForKey(current))?.id).toBe(app.id);
  expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).currentApiKey).toBe(hashApiKey(rotated.currentApiKey));
});
it("rolls back all hash updates if ciphertext cannot be authenticated", async () => {
  const { app, endpoint, current } = await fixture();
  await db.endpoint.update({ where: { id: endpoint.id }, data: { secret: encryptSecret(endpoint.secret, app.id) } });
  vi.stubEnv("ENDPOINT_SECRET_ENCRYPTION_KEY", "22".repeat(32));
  await expect(migrateSecrets(db)).rejects.toThrow();
  expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).currentApiKey).toBe(current);
});
