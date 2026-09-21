export type StatusBucket = { at: string; total: number; success: number };
export function summarizeStatus(buckets: StatusBucket[], now = new Date()) {
  const total = buckets.reduce((n, b) => n + b.total, 0);
  const success = buckets.reduce((n, b) => n + b.success, 0);
  const completedThrough = Math.floor(now.getTime() / 300000) * 300000;
  const incidents: { start: string; end: string | null }[] = [];
  let run: StatusBucket[] = [];
  function finish(end: string | null) { if (run.length >= 2) incidents.push({ start: run[0].at, end }); run = []; }
  for (const bucket of buckets) {
    const time = new Date(bucket.at).getTime();
    if (time >= completedThrough) continue;
    if (run.length && time !== new Date(run[run.length - 1].at).getTime() + 300000) finish(new Date(new Date(run[run.length - 1].at).getTime() + 300000).toISOString());
    if (bucket.total >= 5 && bucket.success / bucket.total < 0.9) run.push(bucket);
    else finish(bucket.at);
  }
  const lastEnd = run.length ? new Date(run[run.length - 1].at).getTime() + 300000 : 0;
  finish(lastEnd === completedThrough ? null : new Date(lastEnd).toISOString());
  return { total, success, successRate: total ? Math.round(success * 10000 / total) / 100 : null, incidents, degraded: incidents.some(i => i.end === null), checkedAt: now.toISOString() };
}
