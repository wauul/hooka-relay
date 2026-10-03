import { afterAll, expect, it, vi } from "vitest";
import type { Event, EventHint } from "@sentry/core";
type Options = { beforeSend: (event: Event, hint?: EventHint) => Event | null; beforeSendTransaction: (event: Event) => Event | null; tracesSampler: () => number; replaysSessionSampleRate: number; replaysOnErrorSampleRate: number };
const sdk = vi.hoisted(() => ({ options: undefined as Options | undefined, navigation: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ init: (options: Options) => { sdk.options = options; }, globalHandlersIntegration: () => ({}), dedupeIntegration: () => ({}), browserTracingIntegration: () => ({}), captureRouterTransitionStart: sdk.navigation }));
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("blocks initial capability loading and navigation before the URL changes, then restores capture on a safe route", async () => {
  const location = { pathname: "/portal/private-token" };
  vi.stubGlobal("window", { location }); vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "1");
  const { onRouterTransitionStart } = await import("../../instrumentation-client");
  const config = sdk.options!;
  expect(config.beforeSend({ message: "private" })).toBeNull(); expect(config.tracesSampler()).toBe(0);
  location.pathname = "/docs"; onRouterTransitionStart("/docs", "push");
  expect(config.beforeSend({ message: "public" })).not.toBeNull(); expect(config.tracesSampler()).toBe(1);
  for (const target of ["/invites/accept?token=secret", "/reset-password?token=secret", "/verify-email?token=secret", "/recovery/secret"]) {
    onRouterTransitionStart(target, "push");
    // Current pathname is still public; pending navigation must already block.
    expect(config.beforeSend({ message: "private" })).toBeNull();
    expect(config.beforeSendTransaction({ type: "transaction", transaction: "/docs" })).toBeNull(); expect(config.tracesSampler()).toBe(0);
    onRouterTransitionStart("/docs", "push"); expect(config.beforeSend({ message: "public" })).not.toBeNull();
  }
  // Browser back/forward send-time location check also protects a private page.
  location.pathname = "/portal/history-token"; expect(config.beforeSend({ message: "private" })).toBeNull();
  expect(config.replaysSessionSampleRate).toBe(0); expect(config.replaysOnErrorSampleRate).toBe(0);
  expect(sdk.navigation).toHaveBeenCalledWith("/docs", "push");
});
