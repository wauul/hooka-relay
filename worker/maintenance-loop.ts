export const ACTIVE_POLL_MS = 5_000;
export const IDLE_POLL_MS = 30 * 60_000;

// One timer owns all database maintenance. Independent timers would prevent
// Neon from suspending even if the outbox itself backed off.
export function maintenanceLoop(run: () => Promise<boolean>, onError: (error: unknown) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;
  let woken = false;
  let current: Promise<void> | undefined;
  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => { current = tick(); }, delay);
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    woken = false;
    let busy = false;
    try { busy = await run(); }
    catch (error) { onError(error); }
    finally {
      running = false;
      if (!stopped) schedule(busy || woken ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    }
  };
  schedule(0);
  return {
    wake() {
      if (stopped || woken) return;
      woken = true;
      if (!running) schedule(ACTIVE_POLL_MS);
    },
    async stop() { stopped = true; clearTimeout(timer); await current; },
  };
}
