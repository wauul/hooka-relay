import { afterAll, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/db";
import { encryptSecret } from "../../lib/secrets";
import { decryptEndpointSecret, encryptEndpointSecret } from "../../lib/endpoint-secrets";
import { migrateEndpointSecrets } from "../../lib/migrate-endpoint-secrets";
import { rotateSigningSecret } from "../../lib/signing-secrets";

afterAll(() => db.$disconnect());
it("migrates legacy ciphertext without changing IDs, keys or formats; is atomic and repeatable", async () => {
  // Dedicated schema inside the Testcontainers database, never production data.
  const schema = "signing_" + randomUUID().replaceAll("-", "");
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const enums = await db.$queryRaw<{ name: string }[]>`SELECT DISTINCT t.typname::text AS name FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid WHERE a.attrelid = 'public."Endpoint"'::regclass AND t.typtype = 'e'`;
  // Prisma qualifies enum parameters using the selected schema. Domain aliases
  // preserve the cloned table's base enum types without touching public tables.
  for (const { name } of enums) {
    if (!/^[A-Za-z]+$/.test(name)) throw new Error("Unexpected fixture enum");
    await db.$executeRawUnsafe(`CREATE DOMAIN "${schema}"."${name}" AS public."${name}"`);
  }
  await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."Endpoint" (LIKE public."Endpoint" INCLUDING ALL)`);
  await db.$executeRawUnsafe(`CREATE TABLE "${schema}"."AuditLog" (LIKE public."AuditLog" INCLUDING ALL)`);
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", schema);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), options: `-c search_path=${schema},public` }, { schema }) });
  try {
    const first = await client.endpoint.create({ data: { id: "legacy", applicationId: "app", url: "https://example.com", secret: encryptSecret("original", "app"), eventTypes: ["*"] } });
    const second = await client.endpoint.create({ data: { id: "invalid", applicationId: "app", url: "https://example.com", secret: "bad-ciphertext", eventTypes: ["*"] } });
    await expect(migrateEndpointSecrets(client)).rejects.toThrow();
    expect((await client.endpoint.findUniqueOrThrow({ where: { id: first.id } })).secret).toBe(first.secret);
    await client.endpoint.update({ where: { id: second.id }, data: { secret: encryptSecret("second", "app") } });
    expect(await migrateEndpointSecrets(client)).toEqual({ migrated: 2 });
    expect(await migrateEndpointSecrets(client)).toEqual({ migrated: 0 });
    const migrated = await client.endpoint.findUniqueOrThrow({ where: { id: first.id } });
    expect(migrated).toMatchObject({ id: first.id, applicationId: "app", signatureFormat: "LEGACY", secretVersion: 1 });
    expect(decryptEndpointSecret(migrated.secret, migrated)).toBe("original");
    expect(() => decryptEndpointSecret(migrated.secret, { ...migrated, id: second.id })).toThrow();
    const rotations = await Promise.allSettled([client.$transaction(tx => rotateSigningSecret(tx, first.id, "owner")), client.$transaction(tx => rotateSigningSecret(tx, first.id, "owner"))]);
    expect(rotations.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = rotations.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
    const rotated = await client.endpoint.findUniqueOrThrow({ where: { id: first.id } });
    expect(decryptEndpointSecret(rotated.previousSecret!, { ...rotated, secretVersion: rotated.previousSecretVersion! })).toBe("original");
    expect(await client.auditLog.count({ where: { action: "signing_secret.rotated", actorId: "owner" } })).toBe(1);
    expect(await client.auditLog.count({ where: { action: "signing_secret.revealed", actorId: "owner" } })).toBe(1);
    await client.endpoint.update({ where: { id: first.id }, data: { previousSecretExpiresAt: new Date(0) } });
    await expect(client.$transaction(tx => rotateSigningSecret(tx, first.id, "owner"))).resolves.toMatchObject({ secretVersion: 3 });
    const next = await client.endpoint.findUniqueOrThrow({ where: { id: first.id } });
    expect(next.secret).toBeTruthy();
    expect(() => decryptEndpointSecret(encryptEndpointSecret("test", next), { ...next, applicationId: "other" })).toThrow();
  } finally {
    await client.$disconnect();
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  }
});

