import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "../../lib/db";
it("migrates realistic legacy owners and all application data without orphaning anything", async () => {
  const apps = await db.application.findMany({
    where: { id: { startsWith: "migration-app" } },
    include: { workspace: { include: { members: true } } },
  });
  expect(apps).toHaveLength(3);
  for (const app of apps) {
    expect(app.workspace.members).toHaveLength(1);
    expect(app.workspace.members[0]).toMatchObject({
      role: "OWNER",
      userId: app.legacyUserId,
    });
  }
  expect(apps.find((a) => a.id === "migration-app")?.currentApiKey).toBe(
    "migration-key",
  );
  expect(apps.find((a) => a.id === "migration-app")?.workspaceId).toBe(
    apps.find((a) => a.id === "migration-app2")?.workspaceId,
  );
  expect(apps.find((a) => a.id === "migration-app3")?.workspaceId).not.toBe(
    apps[0].workspaceId,
  );
  expect(
    await db.workspaceMember.count({ where: { userId: "migration-empty" } }),
  ).toBe(0);
  expect(
    await db.endpoint.findUnique({ where: { id: "migration-endpoint" } }),
  ).toMatchObject({ secret: "original-secret", status: "ACTIVE" });
  expect(
    await db.event.findUnique({ where: { id: "migration-event" } }),
  ).toMatchObject({
    idempotencyKey: "original-idempotency",
    payload: { preserved: true },
  });
  expect(
    await db.delivery.findUnique({ where: { id: "migration-delivery" } }),
  ).toMatchObject({ endpointId: "migration-endpoint" });
  expect(
    await db.deliveryAttempt.findUnique({ where: { id: "migration-attempt" } }),
  ).toMatchObject({ status: "SUCCESS" });
  expect(
    await db.fakeReceipt.findUnique({ where: { key: "migration-counter" } }),
  ).toMatchObject({ calls: 2 });
});

it("backfills readable display names without changing account identifiers", async () => {
  expect(
    await db.user.findUnique({ where: { id: "migration-owner" } }),
  ).toMatchObject({
    email: "migration@example.com",
    displayName: "migration",
    hashedPassword: "hash",
  });
  expect(
    await db.workspace.findUnique({
      where: { id: "personal_migration-owner" },
    }),
  ).toMatchObject({ name: "migration's Workspace" });
});

it("grants the restricted runtime role access to inbound sources", async () => {
  const rows = await db.$queryRaw<{ canSelect: boolean; canInsert: boolean; canUpdate: boolean; canDelete: boolean }[]>`
    SELECT
      has_table_privilege('hooka_runtime', '"WebhookSource"', 'SELECT') AS "canSelect",
      has_table_privilege('hooka_runtime', '"WebhookSource"', 'INSERT') AS "canInsert",
      has_table_privilege('hooka_runtime', '"WebhookSource"', 'UPDATE') AS "canUpdate",
      has_table_privilege('hooka_runtime', '"WebhookSource"', 'DELETE') AS "canDelete"
  `;
  expect(rows[0]).toEqual({ canSelect: true, canInsert: true, canUpdate: true, canDelete: true });
});

it("backfills a legacy single-destination source without changing its endpoint", async () => {
  const id = "migration-routing-source";
  await db.webhookSource.create({ data: { id, applicationId: "migration-app", endpointId: "migration-endpoint", destinationUrl: "https://example.com", name: "Legacy source", provider: "GITHUB", ingestionToken: "migration-routing-token", status: "ACTIVE" } });
  try {
    const sql = readFileSync("prisma/migrations/202609240003_inbound_routing/migration.sql", "utf8");
    const backfill = sql.match(/(INSERT INTO "DestinationGroup"[\s\S]*?;)\s*(INSERT INTO "RoutingDestination"[\s\S]*?;)/);
    expect(backfill).not.toBeNull();
    await db.$executeRawUnsafe(backfill![1]);
    await db.$executeRawUnsafe(backfill![2]);
    const source = await db.webhookSource.findUniqueOrThrow({ where: { id }, include: { destinationGroups: { include: { destinations: { include: { endpoint: true } } } } } });
    expect(source.endpointId).toBe("migration-endpoint");
    expect(source.destinationUrl).toBe("https://example.com");
    expect(source.destinationGroups).toHaveLength(1);
    expect(source.destinationGroups[0]).toMatchObject({ order: 0, triggerCondition: "ALWAYS", successPolicy: "ALL_MUST_SUCCEED" });
    expect(source.destinationGroups[0].destinations).toHaveLength(1);
    expect(source.destinationGroups[0].destinations[0].endpoint).toMatchObject({ id: "migration-endpoint", url: "https://example.com", status: "ACTIVE" });
  } finally { await db.webhookSource.delete({ where: { id } }); }
});
