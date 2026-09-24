import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("next-auth", () => ({ getServerSession: session }));
import { db } from "../../lib/db";
import { defaultWorkspace } from "../../lib/workspaces";
import { GET } from "../../app/api/operator/usage/route";

afterAll(() => db.$disconnect());

it("requires a signed-in allowlisted operator before exporting workspace usage", async () => {
  const email = `${randomUUID()}@example.com`;
  const user = await db.user.create({ data: { email } });
  const workspaceId = await defaultWorkspace(user.id);
  const request = () => new Request(`https://example.com/api/operator/usage?from=2026-09&to=2026-09&workspaceId=${workspaceId}&format=csv`);
  try {
    await db.workspaceUsageMonth.create({ data: { workspaceId, month: new Date("2026-09-01T00:00:00Z"), acceptedEvents: 7n, destinationDeliveries: 12n, retryAttempts: 2n } });
    session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    session.mockResolvedValue({ user: { id: user.id } });
    expect((await GET(request())).status).toBe(404);
    vi.stubEnv("OPERATOR_EMAILS", email);
    const response = await GET(request());
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain('"7","12","2"');
    expect(csv).toContain(workspaceId);
    expect(response.headers.get("cache-control")).toBe("no-store");
  } finally {
    vi.unstubAllEnvs();
    await db.workspace.delete({ where: { id: workspaceId } });
    await db.user.delete({ where: { id: user.id } });
  }
});
