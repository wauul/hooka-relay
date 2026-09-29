import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ACTIVE_POLL_MS, IDLE_POLL_MS, maintenanceLoop } from "../../worker/maintenance-loop";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("leaves more than five minutes without DB activity when idle, but retains a safety sweep", async () => {
  const run = vi.fn().mockResolvedValue(false);
  const loop = maintenanceLoop(run, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(IDLE_POLL_MS - 1);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  loop.stop();
});

it("keeps recovering known work every five seconds and sleeps once drained", async () => {
  const run = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  const loop = maintenanceLoop(run, vi.fn());
  await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS);
  expect(run).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS * 2);
  expect(run).toHaveBeenCalledTimes(2);
  loop.stop();
});

it("broker hints interrupt sleep and repeated hints cannot postpone a check", async () => {
  const run = vi.fn().mockResolvedValue(false);
  const loop = maintenanceLoop(run, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  loop.wake();
  await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS - 1);
  loop.wake();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
  loop.stop();
});

it("does not overlap passes or lose a hint received during a pass", async () => {
  let finish!: (busy: boolean) => void;
  const run = vi.fn().mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; })).mockResolvedValue(false);
  const loop = maintenanceLoop(run, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  loop.wake();
  await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
  expect(run).toHaveBeenCalledTimes(1);
  finish(false);
  await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS);
  expect(run).toHaveBeenCalledTimes(2);
  loop.stop();
});

it("backs off database failures, including exhausted compute, rather than retrying every five seconds", async () => {
  const run = vi.fn().mockRejectedValue(new Error("Compute quota exhausted"));
  const onError = vi.fn();
  const loop = maintenanceLoop(run, onError);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(run).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  expect(run).toHaveBeenCalledTimes(2);
  loop.stop();
});

it("does not restart after shutdown while an async pass is finishing", async () => {
  let finish!: (busy: boolean) => void;
  const run = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const loop = maintenanceLoop(run, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  loop.stop();
  loop.wake();
  finish(true);
  await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);
  expect(run).toHaveBeenCalledOnce();
});
