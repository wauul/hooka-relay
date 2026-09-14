import { describe, it, expect, vi, afterEach } from "vitest";
import { beforeAttempt, afterAttempt, COOLDOWN_MS, FAILURE_THRESHOLD, type Circuit } from "../../lib/circuitBreaker";
const now = new Date("2026-09-14T00:00:00Z");
const closed = (): Circuit => ({ circuitState: "CLOSED", consecutiveFailures: 0, circuitOpenedAt: null });
const open = (): Circuit => ({ circuitState: "OPEN", consecutiveFailures: FAILURE_THRESHOLD, circuitOpenedAt: now });
afterEach(() => vi.useRealTimers());
describe("circuit breaker", () => {
  it("allows delivery in CLOSED", () => expect(beforeAttempt(closed(), now)).toEqual({ allowed: true, state: closed() }));
  it.each([1, 2, 3, 4])("stays CLOSED after %i failures", count => {
    let state = closed();
    for (let i = 0; i < count; i++) state = afterAttempt(state, false, now);
    expect(state).toEqual({ ...closed(), consecutiveFailures: count });
  });
  it("opens exactly at the fifth failure", () => {
    expect(afterAttempt({ ...closed(), consecutiveFailures: FAILURE_THRESHOLD - 1 }, false, now)).toEqual(open());
  });
  it.each([0, 1, COOLDOWN_MS - 1])("rejects attempts at %i ms into cooldown", elapsed => {
    expect(beforeAttempt(open(), new Date(+now + elapsed))).toEqual({ allowed: false, state: open() });
  });
  it.each([COOLDOWN_MS, COOLDOWN_MS + 1])("allows a HALF_OPEN probe after %i ms", elapsed => {
    expect(beforeAttempt(open(), new Date(+now + elapsed))).toEqual({ allowed: true, state: { ...open(), circuitState: "HALF_OPEN" } });
  });
  it("does not reopen when OPEN has no cooldown timestamp", () => expect(beforeAttempt({ ...open(), circuitOpenedAt: null }, now).allowed).toBe(false));
  it("rejects an additional probe while HALF_OPEN", () => expect(beforeAttempt({ ...open(), circuitState: "HALF_OPEN" }, now).allowed).toBe(false));
  it("successful probe closes and clears all failure state", () => expect(afterAttempt({ ...open(), circuitState: "HALF_OPEN" }, true, now)).toEqual(closed()));
  it("failed probe reopens and starts a fresh cooldown", () => {
    const later = new Date(+now + COOLDOWN_MS);
    const state = afterAttempt({ ...open(), circuitState: "HALF_OPEN" }, false, later);
    expect(state).toEqual({ circuitState: "OPEN", consecutiveFailures: 6, circuitOpenedAt: later });
    expect(beforeAttempt(state, new Date(+later + COOLDOWN_MS - 1)).allowed).toBe(false);
  });
  it("success in an already healthy CLOSED state is a value no-op", () => expect(afterAttempt(closed(), true, now)).toEqual(closed()));
  it("success while CLOSED clears previous consecutive failures", () => expect(afterAttempt({ ...closed(), consecutiveFailures: 4 }, true, now)).toEqual(closed()));
  it("rapid failures stop at threshold when admission is checked", () => {
    let state = closed(); let calls = 0;
    for (let i = 0; i < 20; i++) { const gate = beforeAttempt(state, now); if (gate.allowed) { calls++; state = afterAttempt(gate.state, false, now); } }
    expect(calls).toBe(5); expect(state).toEqual(open());
  });
  it("does not mutate its input", () => {
    const state = Object.freeze({ ...closed(), consecutiveFailures: 4 });
    afterAttempt(state, false, now); beforeAttempt(state, now);
    expect(state).toEqual({ ...closed(), consecutiveFailures: 4 });
  });
  it("uses the current time when now is omitted", () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const state = afterAttempt({ ...closed(), consecutiveFailures: 4 }, false);
    expect(state.circuitOpenedAt).toEqual(now);
    vi.advanceTimersByTime(COOLDOWN_MS);
    expect(beforeAttempt(state).allowed).toBe(true);
  });
});
