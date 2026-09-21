import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "../../lib/db";
import { admitSupport } from "../../lib/support-quota";
const req = (ip = "203.0.113.20") => new Request("https://example.com/api/support-chat", { headers: { "x-vercel-forwarded-for": ip } });
beforeEach(async () => { vi.stubEnv("VERCEL", "1"); await db.ipRateBucket.deleteMany({ where: { key: { startsWith: "support:" } } }); });
afterEach(async () => { vi.unstubAllEnvs(); await db.ipRateBucket.deleteMany({ where: { key: { startsWith: "support:" } } }); });
it("admits only ten concurrent requests from an IP across replicas", async () => {
  const admitted = await Promise.all(Array.from({ length: 12 }, () => admitSupport(req())));
  expect(admitted.filter(Boolean)).toHaveLength(10);
  const global = await db.ipRateBucket.findFirstOrThrow({ where: { key: "support:global:day" } }); expect(global.hits).toBe(10);
});
it("enforces the user quota even when the authenticated user changes IP", async () => {
  vi.stubEnv("SUPPORT_LIMIT_PER_MINUTE", "1");
  expect(await admitSupport(req(), "user-a")).toBe(true);
  expect(await admitSupport(req("203.0.113.21"), "user-a")).toBe(false);
  // The rejected transaction did not consume the second IP's quota.
  expect(await admitSupport(req("203.0.113.21"), "user-b")).toBe(true);
});
it("retains the daily budget after minute buckets are cleared", async () => {
  vi.stubEnv("SUPPORT_LIMIT_PER_DAY", "1"); expect(await admitSupport(req())).toBe(true);
  await db.ipRateBucket.deleteMany({ where: { key: { startsWith: "support:minute:" } } });
  expect(await admitSupport(req())).toBe(false);
});
it("enforces the global daily cap across unrelated users and IPs", async () => {
  vi.stubEnv("SUPPORT_GLOBAL_LIMIT_PER_DAY", "1"); expect(await admitSupport(req(), "a")).toBe(true);
  expect(await admitSupport(req("203.0.113.22"), "b")).toBe(false);
});
it("rejects invalid quota configuration before making admissions", async () => {
  vi.stubEnv("SUPPORT_LIMIT_PER_MINUTE", "NaN"); await expect(admitSupport(req())).rejects.toThrow("Invalid SUPPORT_LIMIT_PER_MINUTE");
  expect(await db.ipRateBucket.count({ where: { key: { startsWith: "support:" } } })).toBe(0);
});
