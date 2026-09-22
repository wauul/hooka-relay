import type { Endpoint, Prisma } from "@prisma/client";
import { db } from "./db";
import { newSecret } from "./security";
import { decryptEndpointSecret, encryptEndpointSecret } from "./endpoint-secrets";
import { displaySigningSecret } from "./webhook-signing";
import { WorkspaceError } from "./workspaces";
type Client = Pick<Prisma.TransactionClient, "auditLog">;
export async function revealSigningSecret(endpoint: Endpoint, actorId: string, client: Client = db) {
  const secret = decryptEndpointSecret(endpoint.secret, endpoint);
  await client.auditLog.create({ data: { applicationId: endpoint.applicationId, endpointId: endpoint.id, actorId, action: "signing_secret.revealed", secretVersion: endpoint.secretVersion } });
  return displaySigningSecret(secret, endpoint.signatureFormat);
}
export function secretGraceHours() {
  const hours = Number(process.env.SIGNING_SECRET_GRACE_HOURS || 168);
  if (!Number.isFinite(hours) || hours < 1 || hours > 8760) throw new Error("Invalid SIGNING_SECRET_GRACE_HOURS");
  return hours;
}
export async function rotateSigningSecret(tx: Prisma.TransactionClient, id: string, actorId: string) {
  await tx.$queryRaw`SELECT id FROM "Endpoint" WHERE id = ${id} FOR UPDATE`;
  const ep = await tx.endpoint.findUniqueOrThrow({ where: { id } });
  if (ep.previousSecretExpiresAt && ep.previousSecretExpiresAt > new Date()) throw new WorkspaceError(409, "A signing secret is still in its grace period. Wait before rotating again.");
  const old = decryptEndpointSecret(ep.secret, ep), secretVersion = ep.secretVersion + 1;
  const updated = await tx.endpoint.update({ where: { id }, data: {
    secret: encryptEndpointSecret(newSecret(), { ...ep, secretVersion }), secretVersion,
    previousSecret: encryptEndpointSecret(old, ep), previousSecretVersion: ep.secretVersion,
    previousSecretExpiresAt: new Date(Date.now() + secretGraceHours() * 3600000),
  } });
  await tx.auditLog.create({ data: { applicationId: ep.applicationId, endpointId: id, actorId, action: "signing_secret.rotated", secretVersion } });
  return { secret: await revealSigningSecret(updated, actorId, tx), secretVersion, previousSecretExpiresAt: updated.previousSecretExpiresAt };
}
