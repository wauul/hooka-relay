import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { GenericContainer } from "testcontainers";
import { expect, it } from "vitest";
import { admitFixedWindow, admitMultipleWindows, admitRollingWindow, clearFailureStreak, failureStreak, incrementFailureStreak } from "../../lib/redis-counters";
import { ipRateLimit } from "../../lib/ip-rate-limit";
import { admitEvent } from "../../lib/rate-limit";

it("keeps limits and failure streak atomic across callers using real Redis", async () => {
  const redis = await new GenericContainer("redis:7-alpine").withStartupTimeout(90_000).start();
  // Adapt Upstash's documented JSON-array REST command to a disposable Redis
  // container. Redis executes the exact production Lua scripts, not JS fakes.
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const command = JSON.parse(Buffer.concat(chunks).toString()) as (string | number)[];
      if (command[0] !== "EVAL") throw new Error("Only EVAL is permitted");
      const result = await redis.exec(["redis-cli", "--raw", ...command.map(String)]);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ result: Number(result.output.trim()) }));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: (error as Error).message }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const previousAppLimit = process.env.EVENTS_RATE_LIMIT_PER_MINUTE;
  const previousIpLimit = process.env.EVENTS_IP_LIMIT_PER_MINUTE;
  const previousVercel = process.env.VERCEL;
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
  process.env.EVENTS_RATE_LIMIT_PER_MINUTE = "2";
  process.env.EVENTS_IP_LIMIT_PER_MINUTE = "2";
  process.env.VERCEL = "1";
  try {
    const id = randomUUID();
    const fixed = await Promise.all(Array.from({ length: 8 }, () => admitFixedWindow(`ip:${id}`, 60, 3)));
    expect(fixed.filter(Boolean)).toHaveLength(3);
    const rolling = await Promise.all(Array.from({ length: 8 }, () => admitRollingWindow(id, 3, randomUUID())));
    expect(rolling.filter(value => value === 0)).toHaveLength(3);
    expect(rolling.filter(value => value > 0)).toHaveLength(5);
    const budgets = [{ key: `support:${id}`, seconds: 60, max: 1 }, { key: `global:${id}`, seconds: 86400, max: 2 }];
    expect(await admitMultipleWindows(budgets)).toBe(true);
    expect(await admitMultipleWindows(budgets)).toBe(false);
    expect(await admitMultipleWindows([{ key: `global:${id}`, seconds: 86400, max: 2 }])).toBe(true);
    expect(await incrementFailureStreak(id, 0, `${id}:1`)).toBe(1);
    expect(await incrementFailureStreak(id, 0, `${id}:1`)).toBe(1);
    expect(await incrementFailureStreak(id, 0, `${id}:2`)).toBe(2);
    expect(await failureStreak(id, 0)).toBe(2);
    await clearFailureStreak(id);
    expect(await failureStreak(id, 0)).toBe(0);
    const request = new Request("https://hooka.example/api/v1/events", { headers: { "x-vercel-forwarded-for": "203.0.113.72" } });
    expect((await Promise.all(Array.from({ length: 5 }, () => ipRateLimit(request, "events")))).map(value => value?.status || 200).sort()).toEqual([200, 200, 429, 429, 429]);
    expect((await Promise.all(Array.from({ length: 5 }, () => admitEvent(id + ":route")))).filter(value => value === 0)).toHaveLength(2);
  } finally {
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
    if (previousAppLimit === undefined) delete process.env.EVENTS_RATE_LIMIT_PER_MINUTE;
    else process.env.EVENTS_RATE_LIMIT_PER_MINUTE = previousAppLimit;
    if (previousIpLimit === undefined) delete process.env.EVENTS_IP_LIMIT_PER_MINUTE;
    else process.env.EVENTS_IP_LIMIT_PER_MINUTE = previousIpLimit;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await redis.stop();
  }
}, 120_000);
