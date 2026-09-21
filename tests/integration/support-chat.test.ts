import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({ classify: vi.fn(), generate: vi.fn(), embed: vi.fn(), session: vi.fn() }));
vi.mock("../../lib/support-model", () => ({ classifySupport: mocks.classify, generateSupport: mocks.generate }));
vi.mock("../../lib/support-embeddings", () => ({ embedSupport: mocks.embed }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
import { db } from "../../lib/db";
import { POST } from "../../app/api/support-chat/route";
import { GET } from "../../app/api/support-chat/stats/route";
const send = (question: string) => POST(new Request("https://example.com/api/support-chat", { method: "POST", body: JSON.stringify({ question }) }));
beforeEach(async () => {
  vi.clearAllMocks();
  await db.supportCorpus.upsert({ where: { id: 1 }, create: { id: 1, revision: "test" }, update: { revision: "test" } });
  const vector = JSON.stringify([1, ...Array(383).fill(0)]);
  await db.$executeRaw`INSERT INTO "SupportDocument" (id, source, text, revision, embedding) VALUES (${randomUUID()}, 'README.md', 'Hooka Relay retries failures.', 'test', ${vector}::vector)`;
  mocks.session.mockResolvedValue(null); mocks.embed.mockResolvedValue([1, ...Array(383).fill(0)]); mocks.classify.mockResolvedValue('{"inScope":true,"reason":"product"}'); mocks.generate.mockResolvedValue("Hooka Relay retries failures (README.md).");
});
afterEach(async () => {
  vi.unstubAllEnvs(); await db.supportDocument.deleteMany(); await db.supportCorpus.deleteMany(); await db.supportDecision.deleteMany(); await db.supportAnswerCache.deleteMany(); await db.ipRateBucket.deleteMany({ where: { key: { startsWith: "support:" } } });
});
it("declines without embedding or generation and records classification", async () => {
  mocks.classify.mockResolvedValue('{"inScope":false,"reason":"unrelated"}'); expect((await send("Write a poem")).status).toBe(200); expect(mocks.embed).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled(); expect(await db.supportDecision.count({ where: { inScope: false } })).toBe(1);
});
it("retrieves from pgvector, generates once, then serves normalized cache hits", async () => {
  expect((await send("Hooka Relay retries?")).status).toBe(200); expect(mocks.generate).toHaveBeenCalledWith(expect.anything(), [{ source: "README.md", text: "Hooka Relay retries failures." }]);
  expect((await send("hooka   relay retries?")).status).toBe(200); expect(mocks.classify).toHaveBeenCalledTimes(2); expect(mocks.embed).toHaveBeenCalledOnce(); expect(mocks.generate).toHaveBeenCalledOnce(); expect(await db.supportDecision.count({ where: { cacheHit: true } })).toBe(1);
});
it("rejects input length and quota excess before model calls", async () => {
  expect((await send("x".repeat(501))).status).toBe(400); expect(mocks.classify).not.toHaveBeenCalled(); vi.stubEnv("SUPPORT_LIMIT_PER_MINUTE", "1"); await send("Hooka Relay?"); expect((await send("Hooka Relay?")).status).toBe(429); expect(mocks.classify).toHaveBeenCalledOnce();
});
it("restricts global stats to platform operators", async () => {
  expect((await GET()).status).toBe(401); mocks.session.mockResolvedValue({ user: { id: "workspace-admin" } }); expect((await GET()).status).toBe(403); vi.stubEnv("SUPPORT_ADMIN_USER_IDS", "workspace-admin"); expect((await GET()).status).toBe(200);
});

