export type Circuit = { circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; consecutiveFailures: number; circuitOpenedAt: Date | null };
export const COOLDOWN_MS = 10 * 60 * 1000;
export const FAILURE_THRESHOLD = 5;
// Pure state transitions: callers must serialize endpoint access using a DB lease.
// The lease ensures only one HALF_OPEN probe is ever in flight, across workers.
export function beforeAttempt(c: Circuit, now = new Date()): { allowed: boolean; state: Circuit } {
  if (c.circuitState === 'CLOSED') return { allowed: true, state: c };
  if (c.circuitState === 'OPEN' && c.circuitOpenedAt && now.getTime() - c.circuitOpenedAt.getTime() >= COOLDOWN_MS)
    return { allowed: true, state: { ...c, circuitState: 'HALF_OPEN' } };
  return { allowed: false, state: c };
}
export function afterAttempt(c: Circuit, success: boolean, now = new Date()): Circuit {
  if (success) return { circuitState: 'CLOSED', consecutiveFailures: 0, circuitOpenedAt: null };
  const consecutiveFailures = c.consecutiveFailures + 1;
  if (c.circuitState === 'HALF_OPEN' || consecutiveFailures >= FAILURE_THRESHOLD)
    return { circuitState: 'OPEN', consecutiveFailures, circuitOpenedAt: now };
  return { ...c, consecutiveFailures };
}
