import type { PrismaClient } from "@prisma/client";
import { decryptEndpointSecret, encryptEndpointSecret } from "./endpoint-secrets";
export async function migrateEndpointSecrets(client: PrismaClient) {
  return client.$transaction(async tx => {
    // Run after the reader-compatible release. The table lock serializes web
    // writes/rotation; plaintext and signature formats remain byte-for-byte.
    await tx.$executeRawUnsafe('LOCK TABLE "Endpoint" IN SHARE ROW EXCLUSIVE MODE');
    let migrated = 0;
    for (const endpoint of await tx.endpoint.findMany()) {
      const plaintext = decryptEndpointSecret(endpoint.secret, endpoint);
      if (endpoint.secretVersion !== 0) continue;
      const context = { ...endpoint, secretVersion: 1 };
      const secret = encryptEndpointSecret(plaintext, context);
      if (decryptEndpointSecret(secret, context) !== plaintext) throw new Error("Secret verification failed");
      await tx.endpoint.update({ where: { id: endpoint.id }, data: { secret, secretVersion: 1 } });
      migrated++;
    }
    return { migrated };
  }, { timeout: 120000 });
}
