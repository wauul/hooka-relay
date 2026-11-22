import { hashApiKey } from "./secrets";
import { workspaceTransaction, WorkspaceError } from "./workspaces";
import { db } from "./db";
import { newSecret } from "./security";
export function keyGraceHours() {
  const hours = Number(process.env.API_KEY_GRACE_HOURS || 24);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 8760)
    throw new Error("Invalid API_KEY_GRACE_HOURS");
  return hours;
}
export function keyIsValid(
  app: {
    currentApiKey: string;
    previousApiKey: string | null;
    previousApiKeyExpiresAt: Date | null;
  },
  key: string,
  now = new Date(),
) {
  return (
    app.currentApiKey === hashApiKey(key) ||
    (app.previousApiKey === hashApiKey(key) &&
      !!app.previousApiKeyExpiresAt &&
      app.previousApiKeyExpiresAt > now)
  );
}
type KeyPermission = "INGEST" | "READ" | "MANAGE";

export async function applicationForKey(key: string, permission: KeyPermission = "INGEST") {
  if (key.length > 256) return null;
  return applicationForKeyHash(hashApiKey(key), permission, true);
}

export async function applicationForKeyHash(hash: string, permission: KeyPermission, recordUse: boolean) {
  const now = new Date();
  const legacy = await db.application.findFirst({
    where: {
      OR: [
        { currentApiKey: hash },
        { previousApiKey: hash, previousApiKeyExpiresAt: { gt: now } },
      ],
    },
  }); 
  if (legacy) return legacy; // Existing unscoped keys retain all capabilities.
  const scoped = await db.applicationKey.findFirst({ where: { hash, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, include: { application: true } });
  if (!scoped) return null;
  if (permission === "MANAGE" || (permission === "READ" ? scoped.scope !== "READ_ONLY" : scoped.scope !== "INGEST_ONLY")) throw new WorkspaceError(403, "API key scope does not permit this action");
  if (recordUse) await db.applicationKey.update({ where: { id: scoped.id }, data: { lastUsedAt: now } });
  return scoped.application;
}
export async function rotateKey(id: string, userId: string) {
  const application = await db.application.findUniqueOrThrow({ where: { id } });
  return workspaceTransaction(
    application.workspaceId,
    userId,
    "manage",
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${id} FOR UPDATE`;
      const app = await tx.application.findUniqueOrThrow({ where: { id } });
      // Two slots cannot honor a third concurrent generation's grace window.
      if (
        app.previousApiKeyExpiresAt &&
        app.previousApiKeyExpiresAt > new Date()
      )
        throw new Error("KEY_GRACE_ACTIVE");
      const plaintext = "hr_live_" + newSecret();
      const rotated = await tx.application.update({
        where: { id },
        data: {
          currentApiKey: hashApiKey(plaintext),
          previousApiKey: app.currentApiKey,
          previousApiKeyExpiresAt: new Date(
            Date.now() + keyGraceHours() * 3600000,
          ),
        },
      });
      return { ...rotated, currentApiKey: plaintext };
    },
  );
}
