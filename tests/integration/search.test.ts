import { beforeEach, afterEach, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const auth = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: auth.session }));
import { db } from "../../lib/db";
import { GET } from "../../app/api/search/route";
let users: string[];
beforeEach(async () => {
  auth.session.mockResolvedValue(null);
  users = [];
});
afterEach(async () => {
  for (const userId of users) {
    await db.event.deleteMany({ where: { application: { userId } } });
    await db.endpoint.deleteMany({ where: { application: { userId } } });
    await db.application.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
});
afterAll(() => db.$disconnect());
const search = (q: string) =>
  GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`));
it("serves docs to signed-out visitors without workspace data", async () => {
  const response = await search("HMAC");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(
    (await response.json()).results.some(
      (r: { href: string }) => r.href === "/docs#signatures",
    ),
  ).toBe(true);
});
it("isolates applications, endpoints and events to the current session user", async () => {
  for (let i = 0; i < 2; i++) {
    const user = await db.user.create({
      data: { email: `${randomUUID()}@example.com`, hashedPassword: "unused" },
    });
    users.push(user.id);
    const app = await db.application.create({
      data: {
        userId: user.id,
        name: `findme ${i}`,
        apiKey: `secret-${randomUUID()}`,
      },
    });
    await db.endpoint.create({
      data: {
        applicationId: app.id,
        url: `https://example.com/findme-${i}`,
        secret: "must-not-leak",
        eventTypes: ["*"],
      },
    });
    await db.event.create({
      data: {
        applicationId: app.id,
        type: `findme.${i}`,
        payload: { secret: "must-not-leak" },
        idempotencyKey: randomUUID(),
      },
    });
  }
  auth.session.mockResolvedValue({ user: { id: users[0] } });
  const response = await search("findme");
  const data = await response.json();
  expect(data.results).toHaveLength(3);
  expect(data.results.map((r: { title: string }) => r.title)).toEqual([
    "findme 0",
    "https://example.com/findme-0",
    "findme.0",
  ]);
  expect(JSON.stringify(data)).not.toContain("must-not-leak");
  expect(JSON.stringify(data)).not.toContain("apiKey");
  auth.session.mockResolvedValue(null);
  expect((await (await search("findme")).json()).results).toEqual([]);
});
it("bounds query length", async () => {
  expect((await search("x".repeat(101))).status).toBe(400);
  expect((await (await search("x")).json()).results).toEqual([]);
});
