import { expect, it } from "vitest";
import { db } from "../../lib/db";
it("migrates realistic legacy owners and all application data without orphaning anything", async () => {
  const apps = await db.application.findMany({ where: { id: { startsWith: "migration-app" } }, include: { workspace: { include: { members: true } } } });
  expect(apps).toHaveLength(3);
  for (const app of apps) {
    expect(app.workspace.members).toHaveLength(1);
    expect(app.workspace.members[0]).toMatchObject({ role: "OWNER", userId: app.legacyUserId });
  }
  expect(apps.find(a => a.id === "migration-app")?.currentApiKey).toBe("migration-key");
  expect(apps.find(a => a.id === "migration-app")?.workspaceId).toBe(apps.find(a => a.id === "migration-app2")?.workspaceId);
  expect(apps.find(a => a.id === "migration-app3")?.workspaceId).not.toBe(apps[0].workspaceId);
  expect(await db.workspaceMember.count({ where: { userId: "migration-empty" } })).toBe(0);
  expect(await db.endpoint.findUnique({ where: { id: "migration-endpoint" } })).toMatchObject({ secret: "original-secret", status: "ACTIVE" });
  expect(await db.event.findUnique({ where: { id: "migration-event" } })).toMatchObject({ idempotencyKey: "original-idempotency", payload: { preserved: true } });
  expect(await db.delivery.findUnique({ where: { id: "migration-delivery" } })).toMatchObject({ endpointId: "migration-endpoint" });
  expect(await db.deliveryAttempt.findUnique({ where: { id: "migration-attempt" } })).toMatchObject({ status: "SUCCESS" });
  expect(await db.fakeReceipt.findUnique({ where: { key: "migration-counter" } })).toMatchObject({ calls: 2 });
});
