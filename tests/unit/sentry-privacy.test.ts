import { describe, expect, it } from "vitest";
import { expectedError, privateEvent, privateSpan, privateBreadcrumb, safeRoute, sensitiveRoute } from "../../lib/sentry-privacy";
import { sampleRatio, sentryOptions } from "../../lib/sentry-options";
import { vi, afterEach } from "vitest";
afterEach(() => vi.unstubAllEnvs());
describe("Sentry privacy", () => {
  it("removes arbitrary secrets from errors and every metadata surface while retaining source-map coordinates", () => {
    const secret = "password=private-payload-token";
    const result = privateEvent({ event_id: "a".repeat(32), request: { url: "https://receiver/portal/token?q=secret", headers: { authorization: secret }, data: secret, cookies: { cookie: secret } }, user: { email: secret }, extra: { sql: secret }, contexts: { custom: { value: secret } }, tags: { secret, service: "worker", attempt: "2" }, message: secret, exception: { values: [{ type: "Error", value: secret, stacktrace: { frames: [{ filename: "app:///dist/worker/process-job.js", lineno: 30, colno: 8, vars: { password: secret }, pre_context: [secret], context_line: secret }] } }] }, breadcrumbs: [{ category: "console", message: secret, data: { secret } }], spans: [{ trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 1, timestamp: 2, description: secret, data: { "db.statement": secret } }] });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result?.request).toBeUndefined(); expect(result?.user).toBeUndefined(); expect(result?.extra).toBeUndefined();
    expect(result?.exception?.values?.[0]?.stacktrace?.frames?.[0]).toMatchObject({ lineno: 30, colno: 8 });
    expect(result?.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBe("app:///dist/worker/process-job.js");
    expect(result?.exception?.values?.[0]?.stacktrace?.frames?.[0]).toMatchObject({ abs_path: "app:///dist/worker/process-job.js" });
    expect(result?.tags).toEqual({ service: "worker", attempt: "2" });
    expect(result?.breadcrumbs).toEqual([]);
  });
  it.each(["/portal/capability", "/invites/accept?token=secret", "/reset-password?token=secret", "/verify-email?token=secret", "/recovery/secret", "/api/portal/token", "/api/account/reset-password", "/%70ortal/token"])("blocks sensitive initial loading and navigation to %s", path => {
    expect(sensitiveRoute(path)).toBe(true);
    expect(privateEvent({ message: "failure" }, undefined, path)).toBeNull();
    expect(privateEvent({ type: "transaction", transaction: path })).toBeNull();
  });
  it("normalizes routes and removes query strings, customer origins and path tokens", () => {
    expect(safeRoute("GET https://customer.example/api/endpoints/SECRET_TOKEN/events/ID?password=secret")).toBe("/api/endpoints/[id]/events/[id]");
    expect(privateBreadcrumb({ category: "navigation", data: { to: "/portal/secret" } })).toBeNull();
    expect(privateSpan({ trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 1, timestamp: 2, description: "SELECT private FROM secret", data: { password: "secret" } }).data).toEqual({});
  });
  it("drops only explicit expected failures", () => {
    class InputLimitError extends Error {}
    expect(expectedError(new InputLimitError("payload"))).toBe(true);
    expect(expectedError(new Error("UNAUTHORIZED"))).toBe(true);
    expect(expectedError(new Error("database credentials rejected"))).toBe(false);
    expect(expectedError(new TypeError("program defect"))).toBe(false);
    expect(privateEvent({ exception: { values: [{ value: "bad" }] } }, { originalException: new Error("FORBIDDEN") })).toBeNull();
  });
  it("does not require configuration and never couples errors to tracing", () => {
    vi.stubEnv("SENTRY_DSN", ""); vi.stubEnv("SENTRY_DISABLED", "false"); vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "0");
    expect(sentryOptions("web").enabled).toBe(false);
    expect(sentryOptions("web").tracesSampleRate).toBe(0);
    vi.stubEnv("SENTRY_DSN", "https://public@o1.ingest.sentry.io/1");
    expect(sentryOptions("web").enabled).toBe(true);
    vi.stubEnv("SENTRY_DISABLED", "true"); expect(sentryOptions("web").enabled).toBe(false);
    expect(sampleRatio("NaN")).toBe(0.05); expect(sampleRatio("1.5")).toBe(0.05);
  });
});
