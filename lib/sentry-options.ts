import { beforeSend, privateBreadcrumb, privateEvent, privateSpan } from "./sentry-privacy";
import type { TransactionEvent } from "@sentry/core";
export function sampleRatio(value: string | undefined, fallback = 0.05) {
  if (!value?.trim()) return fallback;
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : fallback;
}
export function sentryOptions(service: "web" | "worker" | "edge") {
  const dsn = service === "worker" ? process.env.SENTRY_WORKER_DSN : process.env.SENTRY_DSN;
  return {
    dsn, enabled: !!dsn && process.env.SENTRY_DISABLED !== "true",
    release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || (process.env.NODE_ENV === "production" ? "production" : "development"),
    sendDefaultPii: false, enableLogs: false, sendClientReports: false, maxBreadcrumbs: 10,
    tracesSampleRate: sampleRatio(process.env.SENTRY_TRACES_SAMPLE_RATE), traceLifecycle: "static" as const,
    beforeSend, beforeBreadcrumb: privateBreadcrumb, beforeSendSpan: privateSpan,
    beforeSendTransaction: (event: TransactionEvent) => privateEvent(event),
    beforeSendLog: () => null,
    initialScope: { tags: { service } },
    // No outbound auto instrumentation: manual spans preserve webhook secrecy.
    tracePropagationTargets: [] as string[],
  };
}
