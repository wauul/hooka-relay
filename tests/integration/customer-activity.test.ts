import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("next-auth", () => ({ getServerSession: session }));
import { db } from "../../lib/db";
import { createWorkspace } from "../../lib/workspaces";
import { GET } from "../../app/api/applications/[id]/activity/route";

it("shows only the selected customer's recent activity and rejects a foreign customer", async () => {
  const owner = await db.user.create({ data: { email: `${randomUUID()}@example.com` } });
  const workspace = await createWorkspace(owner.id, "Activity test");
  session.mockResolvedValue({ user: { id: owner.id } });
  try {
    const app = await db.application.create({ data: { workspaceId: workspace.id, name: "Activity", currentApiKey: randomUUID() } });
    const otherApp = await db.application.create({ data: { workspaceId: workspace.id, name: "Other", currentApiKey: randomUUID() } });
    const [selected, other, foreign] = await Promise.all([
      db.customer.create({ data: { applicationId: app.id, externalId: "selected", name: "Selected" } }),
      db.customer.create({ data: { applicationId: app.id, externalId: "other", name: "Other" } }),
      db.customer.create({ data: { applicationId: otherApp.id, externalId: "foreign", name: "Foreign" } }),
    ]);
    await Promise.all([selected, other].map(async customer => {
      await db.endpoint.create({ data: { applicationId: app.id, customerId: customer.id, url: `https://example.com/${customer.externalId}`, secret: "test", eventTypes: ["*"] } });
      await db.event.create({ data: { applicationId: app.id, customerId: customer.id, type: `${customer.externalId}.event`, idempotencyKey: randomUUID(), payload: {} } });
    }));
    const response = await GET(new Request(`https://example.com/api/applications/${app.id}/activity?customerId=${selected.id}`), { params: Promise.resolve({ id: app.id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.customer.name).toBe("Selected");
    expect(body.endpoints).toBe(1);
    expect(body.events).toBe(1);
    expect(body.dailyEvents.reduce((sum: number, day: { count: number }) => sum + day.count, 0)).toBe(1);
    expect(body.recentEvents.map((event: { type: string }) => event.type)).toEqual(["selected.event"]);
    expect(JSON.stringify(body)).not.toContain("other.event");
    const denied = await GET(new Request(`https://example.com/api/applications/${app.id}/activity?customerId=${foreign.id}`), { params: Promise.resolve({ id: app.id }) });
    expect(denied.status).toBe(404);
  } finally {
    await db.workspace.delete({ where: { id: workspace.id } });
    await db.user.delete({ where: { id: owner.id } });
  }
});
