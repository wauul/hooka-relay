import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentry-options";
import { startObservability } from "./lib/observability-runtime";
const options = sentryOptions("web");
Sentry.init({ ...options, skipOpenTelemetrySetup: true, integrations: [], defaultIntegrations: false });
startObservability("web", options.enabled ? Sentry.getClient() : undefined);
