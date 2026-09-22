import { decryptEndpointSecret } from "./endpoint-secrets";
import type { PrismaClient } from "@prisma/client";
import { decryptSecret, encryptSecret, encryptionKey, hashApiKey, isHashedKey } from "./secrets";

// Run offline with web writes and workers stopped. Atomic, idempotent, and does
// not print credentials. No row is deleted; IDs/ownership/grace dates stay intact.
export async function migrateSecrets(client: PrismaClient) {
  encryptionKey(); // Validate before opening a transaction.
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "Application", "Endpoint" IN SHARE ROW EXCLUSIVE MODE');
    const apps = await tx.application.findMany();
    let applications = 0, endpoints = 0;
    for (const app of apps) {
      if (!isHashedKey(app.currentApiKey) || (app.previousApiKey && !isHashedKey(app.previousApiKey))) {
        await tx.application.update({ where: { id: app.id }, data: {
          currentApiKey: isHashedKey(app.currentApiKey) ? app.currentApiKey : hashApiKey(app.currentApiKey),
          previousApiKey: app.previousApiKey && (isHashedKey(app.previousApiKey) ? app.previousApiKey : hashApiKey(app.previousApiKey)),
        } });
        applications++;
      }
    }
    for (const endpoint of await tx.endpoint.findMany()) {
      if (endpoint.secret.startsWith("enc:")) {
        decryptEndpointSecret(endpoint.secret, endpoint); // Wrong key aborts all changes, including v2 rows.
        continue;
      }
      const encrypted = encryptSecret(endpoint.secret, endpoint.applicationId);
      if (decryptSecret(encrypted, endpoint.applicationId) !== endpoint.secret) throw new Error("Encryption verification failed");
      await tx.endpoint.update({ where: { id: endpoint.id }, data: { secret: encrypted } });
      endpoints++;
    }
    return { applications, endpoints };
  }, { timeout: 120000 });
}
