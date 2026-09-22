import { expect, it } from "vitest";
import { failurePattern, type PatternAttempt } from "../../lib/failure-pattern";
const attempt = (i: number, code = 200, overrides: Partial<PatternAttempt> = {}): PatternAttempt => ({ createdAt: new Date(1700000000000 + i * 60000), status: code < 300 ? "SUCCESS" : "FAILED", httpStatusCode: code, durationMs: 100, responseBody: "ok", responseHeaders: {}, error: null, ...overrides });
it("finds the start of a new failure streak after a successful delivery", () => {
  const rows = [attempt(0), attempt(1, 401), attempt(2, 401), attempt(3, 401)];
  const pattern = failurePattern([...rows].reverse());
  expect(pattern.startedAt).toBe(rows[1].createdAt.toISOString()); expect(pattern.active).toBe(true);
  expect(pattern.summary).toContain("latest 3 returned HTTP 401"); expect(pattern.summary).not.toContain("at least");
  expect(pattern.changes[0]).toContain("HTTP 200 to HTTP 401");
});
it("bounds history and identifies an unknown earlier start without inventing it", () => {
  const rows = Array.from({ length: 30 }, (_, i) => attempt(i, 500));
  const pattern = failurePattern(rows); expect(pattern.observed).toBe(20); expect(pattern.summary).toContain("since at least"); expect(pattern.startedAt).toBe(rows[10].createdAt.toISOString());
});
it("excludes circuit skips and reports recovery without an active failure streak", () => {
  const pattern = failurePattern([attempt(1, 500), attempt(2, 500, { status: "SKIPPED_CIRCUIT_OPEN" }), attempt(3)]);
  expect(pattern.observed).toBe(2); expect(pattern.active).toBe(false); expect(pattern.startedAt).toBeNull(); expect(pattern.summary).toContain("succeeded");
  expect(failurePattern([]).observed).toBe(0);
});
it("detects latency, redirect and captured response-size changes without leaking content", () => {
  const rows = Array.from({ length: 6 }, (_, i) => attempt(i, i < 3 ? 200 : 302, i < 3 ? {} : { durationMs: 1200, responseBody: "private".repeat(200), responseHeaders: { location: "https://private.example/token" } }));
  const pattern = failurePattern(rows);
  expect(pattern.changes.join(" ")).toMatch(/latency rose.*100 ms to 1200 ms/);
  expect(pattern.changes.join(" ")).toContain("response size changed"); expect(pattern.changes.join(" ")).toContain("redirect first appeared");
  expect(JSON.stringify(pattern)).not.toContain("private");
});
it("labels expired-token-shaped evidence as unconfirmed and handles missing latency", () => {
  const pattern = failurePattern([attempt(1, 401, { responseBody: "token expired", durationMs: null })]);
  expect(pattern.changes.join(" ")).toContain("not a confirmed cause");
  expect(failurePattern([attempt(1, 500, { httpStatusCode: null, error: "timeout" })]).summary).toContain("a timeout");
});
