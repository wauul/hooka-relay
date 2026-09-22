export type PatternAttempt = {
  createdAt: Date; status: string; httpStatusCode: number | null;
  durationMs: number | null; responseBody: string | null;
  responseHeaders?: unknown; error: string | null;
};
const outcome = (a: PatternAttempt) => a.httpStatusCode ? `HTTP ${a.httpStatusCode}` : a.error === "timeout" ? "a timeout" : a.error === "transform_failed" ? "a payload transformation failure" : "a connection failure";
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const redirect = (a: PatternAttempt) => (a.httpStatusCode !== null && a.httpStatusCode >= 300 && a.httpStatusCode < 400) || (!!a.responseHeaders && typeof a.responseHeaders === "object" && Object.keys(a.responseHeaders).some(k => k.toLowerCase() === "location"));

// Facts from a bounded window, not an LLM inference. Never expose response text or URLs.
export function failurePattern(input: PatternAttempt[]) {
  const attempts = input.filter(a => a.status !== "SKIPPED_CIRCUIT_OPEN").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20).reverse();
  const latest = attempts.at(-1);
  if (!latest) return { active: false, startedAt: null, observed: 0, summary: "No HTTP attempts in this recent window.", changes: [] as string[] };
  const lastSuccess = attempts.findLastIndex(a => a.status === "SUCCESS");
  const failures = attempts.slice(lastSuccess + 1);
  const changes: string[] = [];
  for (let i = 1; i < attempts.length; i++) {
    if (outcome(attempts[i - 1]) !== outcome(attempts[i])) changes.push(`At ${attempts[i].createdAt.toISOString()}, responses changed from ${outcome(attempts[i - 1])} to ${outcome(attempts[i])}.`);
  }
  const recent = attempts.slice(-3), baseline = attempts.slice(0, -3);
  if (baseline.length >= 3) {
    const priorMs = baseline.flatMap(a => a.durationMs === null ? [] : [a.durationMs]);
    const recentMs = recent.flatMap(a => a.durationMs === null ? [] : [a.durationMs]);
    if (priorMs.length >= 3 && recentMs.length === 3) {
      const before = median(priorMs), after = median(recentMs);
      if (after >= Math.max(before * 2, before + 500)) changes.push(`Median latency rose from ${before} ms to ${after} ms in the latest three attempts.`);
      else if (before >= Math.max(after * 2, after + 500)) changes.push(`Median latency fell from ${before} ms to ${after} ms in the latest three attempts.`);
    }
    const before = median(baseline.map(a => Buffer.byteLength(a.responseBody || "")));
    const after = median(recent.map(a => Buffer.byteLength(a.responseBody || "")));
    if (Math.abs(after - before) >= 512 && (after >= before * 2 || before >= after * 2)) changes.push(`Median captured response size changed from ${before} to ${after} bytes; bodies may be truncated at 16 KB.`);
    if (!baseline.some(redirect) && recent.some(redirect)) changes.push(`A redirect first appeared in the recent window at ${recent.find(redirect)!.createdAt.toISOString()}; Hooka Relay does not follow redirects.`);
  }
  if ([401, 403].includes(latest.httpStatusCode || 0) && /(?:expired.{0,40}(?:token|credential)|(?:token|credential).{0,40}expired)/i.test(latest.responseBody || "")) changes.push("The latest authentication error mentions an expired token or credential; this is receiver-provided evidence, not a confirmed cause.");
  let same = 0;
  for (const a of [...failures].reverse()) { if (outcome(a) !== outcome(latest)) break; same++; }
  const startedAt = failures[0]?.createdAt.toISOString() ?? null;
  const summary = failures.length
    ? `Failing ${lastSuccess < 0 ? "since at least" : "since"} ${startedAt}: ${failures.length} observed failed attempts. The latest ${same} returned ${outcome(latest)}.`
    : `The latest delivery succeeded at ${latest.createdAt.toISOString()}.`;
  return { active: failures.length > 0, startedAt, observed: attempts.length, summary, changes: changes.slice(-5) };
}
