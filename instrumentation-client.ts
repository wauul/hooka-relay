import * as Sentry from "@sentry/nextjs";
import { privateEvent, privateBreadcrumb, privateSpan, sensitiveRoute } from "./lib/sentry-privacy";
import { sampleRatio } from "./lib/sentry-options";

const path = () => typeof window === "undefined" ? "/" : window.location.pathname;
let privateNavigation = sensitiveRoute(path());
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NEXT_PUBLIC_SENTRY_DISABLED !== "true",
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development",
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  sendDefaultPii: false, sendClientReports: false, enableLogs: false,
  defaultIntegrations: false,
  // SDK/object deduplication keeps boundary reports unique. A stack-based dedupe
  // cache would also remember filtered private-page errors and suppress the first
  // legitimate occurrence after navigating back to a public page.
  integrations: [Sentry.globalHandlersIntegration(), Sentry.browserTracingIntegration()],
  tracePropagationTargets: [/^\/api\/(?!portal|invites|account|inbound)/],
  tracesSampler: () => privateNavigation || sensitiveRoute(path()) ? 0 : sampleRatio(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
  replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0,
  beforeSend: (event, hint) => privateNavigation ? null : privateEvent(event, hint, path()),
  beforeSendTransaction: event => privateNavigation ? null : privateEvent(event, undefined, path()),
  beforeBreadcrumb: privateBreadcrumb, beforeSendSpan: privateSpan,
  beforeSendLog: () => null,
  initialScope: { tags: { service: "browser" } },
});
export const onRouterTransitionStart = (href: string, navigationType: string) => {
  // Runs before URL changes. Send-time path checks also cover back/forward.
  privateNavigation = sensitiveRoute(href);
  if (!privateNavigation) Sentry.captureRouterTransitionStart(href, navigationType);
};
