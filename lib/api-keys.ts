import { workspaceTransaction } from "./workspaces";
import { db } from "./db";
import { newSecret } from "./security";
export function keyGraceHours() {
  const hours = Number(process.env.API_KEY_GRACE_HOURS || 24);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) throw new Error("Invalid API_KEY_GRACE_HOURS");
  return hours;
}
export function keyIsValid(app: { currentApiKey: string; previousApiKey: string | null; previousApiKeyExpiresAt: Date | null }, key: string, now = new Date()) {
  return app.currentApiKey === key || (app.previousApiKey === key && !!app.previousApiKeyExpiresAt && app.previousApiKeyExpiresAt > now);
}
export function applicationForKey(key: string) {
  return db.application.findFirst({ where: { OR: [{ currentApiKey: key }, { previousApiKey: key, previousApiKeyExpiresAt: { gt: new Date() } }] } });
}
export async function rotateKey(id: string, userId: string) {
  const application = await db.application.findUniqueOrThrow({ where: { id } });
  return workspaceTransaction(application.workspaceId, userId, "manage", async tx => {
    await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${id} FOR UPDATE`;
    const app = await tx.application.findUniqueOrThrow({ where: { id } });
    // Two slots cannot honor a third concurrent generation's grace window.
    if (app.previousApiKeyExpiresAt && app.previousApiKeyExpiresAt > new Date()) throw new Error("KEY_GRACE_ACTIVE");
    return tx.application.update({ where: { id }, data: {
      currentApiKey: "hr_live_" + newSecret(), previousApiKey: app.currentApiKey,
      previousApiKeyExpiresAt: new Date(Date.now() + keyGraceHours() * 3600000),
    } });
  });
}
