import { expect, it, vi } from "vitest";
import { ipRateLimit } from "../../lib/ip-rate-limit";
import { db } from "../../lib/db";
it("limits concurrent unauthenticated requests per IP and separately by scope", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("EVENTS_IP_LIMIT_PER_MINUTE", "3");
  vi.stubEnv("AUTH_IP_LIMIT_PER_MINUTE", "2");
  try {
    const req = new Request("https://example.com", {
      headers: { "x-vercel-forwarded-for": "203.0.113.42" },
    });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => ipRateLimit(req, "events")),
    );
    expect(responses.filter((r) => r === null)).toHaveLength(3);
    expect(responses.filter((r) => r?.status === 429)).toHaveLength(5);
    expect(responses.find((r) => r)?.headers.get("Retry-After")).toBe("60");
    expect(await ipRateLimit(req, "auth")).toBeNull();
    expect(await ipRateLimit(req, "auth")).toBeNull();
    expect((await ipRateLimit(req, "auth"))?.status).toBe(429);
    const other = new Request("https://example.com", {
      headers: { "x-vercel-forwarded-for": "203.0.113.43" },
    });
    expect(await ipRateLimit(other, "events")).toBeNull();
  } finally {
    vi.unstubAllEnvs();
    await db.$executeRaw`DELETE FROM "IpRateBucket"`;
  }
});
import { POST as publicEvents } from "../../app/api/v1/events/route";
import { POST as signup } from "../../app/api/signup/route";
it("rejects unauthenticated floods before key lookup and limits signup attempts", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("EVENTS_IP_LIMIT_PER_MINUTE", "1");
  vi.stubEnv("AUTH_IP_LIMIT_PER_MINUTE", "1");
  const req = () =>
    new Request("https://example.com/api/test", {
      method: "POST",
      headers: {
        "x-vercel-forwarded-for": "203.0.113.44",
        "content-type": "application/json",
      },
      body: "{}",
    });
  try {
    expect((await publicEvents(req())).status).toBe(401);
    expect((await publicEvents(req())).status).toBe(429);
    expect((await signup(req())).status).toBe(400);
    expect((await signup(req())).status).toBe(429);
  } finally {
    vi.unstubAllEnvs();
    await db.$executeRaw`DELETE FROM "IpRateBucket"`;
  }
});
