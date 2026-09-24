// The REST transport works in both Vercel functions and the long-running worker.
// Every admission is one Redis EVAL, so concurrent replicas cannot overspend it.
export function redisConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export async function redisEval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", script, keys.length, ...keys, ...args]),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const data = await response.json() as { result?: T; error?: string };
  if (data.error || data.result === undefined) throw new Error(`Redis command failed: ${data.error || "missing result"}`);
  return data.result;
}

// Fixed windows use Redis server time, matching the former Postgres NOW() buckets.
const fixedWindowScript = `
local now = redis.call('TIME')
local bucket = math.floor(tonumber(now[1]) / tonumber(ARGV[1]))
local key = KEYS[1] .. ':' .. bucket
local current = tonumber(redis.call('GET', key) or '0')
if current >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', key)
redis.call('EXPIRE', key, tonumber(ARGV[1]) * 2)
return 1`;

export async function admitFixedWindow(key: string, seconds: number, maximum: number) {
  return (await redisEval<number>(fixedWindowScript, [`hooka:limit:${key}`], [seconds, maximum])) === 1;
}

// Check all budgets before any increment: a rejected support request spends none.
const multiWindowScript = `
local now = redis.call('TIME')
local keys = {}
for i = 1, #KEYS do
  local seconds = tonumber(ARGV[2*i-1])
  keys[i] = KEYS[i] .. ':' .. math.floor(tonumber(now[1]) / seconds)
  if tonumber(redis.call('GET', keys[i]) or '0') >= tonumber(ARGV[2*i]) then return 0 end
end
for i = 1, #KEYS do
  redis.call('INCR', keys[i])
  redis.call('EXPIRE', keys[i], tonumber(ARGV[2*i-1]) * 2)
end
return 1`;

export async function admitMultipleWindows(budgets: { key: string; seconds: number; max: number }[]) {
  return (await redisEval<number>(multiWindowScript, budgets.map(b => `hooka:limit:${b.key}`), budgets.flatMap(b => [b.seconds, b.max]))) === 1;
}

const rollingScript = `
local now = redis.call('TIME')
local millis = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', millis - 60000)
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[1]) then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return math.max(1, math.ceil((tonumber(first[2]) + 60000 - millis) / 1000))
end
redis.call('ZADD', KEYS[1], millis, ARGV[2])
redis.call('EXPIRE', KEYS[1], 120)
return 0`;

export async function admitRollingWindow(applicationId: string, maximum: number, member: string) {
  return redisEval<number>(rollingScript, [`hooka:admission:${applicationId}`], [maximum, member]);
}
