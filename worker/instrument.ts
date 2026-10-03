import "dotenv/config";
import * as Sentry from "@sentry/node";
import { sentryOptions } from "../lib/sentry-options";
import { startObservability } from "../lib/observability-runtime";
const options = sentryOptions("worker");
Sentry.init({ ...options, skipOpenTelemetrySetup: true, defaultIntegrations: false, integrations: [] });
startObservability("worker", options.enabled ? Sentry.getClient() : undefined);
