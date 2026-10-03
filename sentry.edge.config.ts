import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentry-options";
// No routes currently select Edge. Kept ready for an explicit future Edge route.
Sentry.init({ ...sentryOptions("edge"), defaultIntegrations: false, integrations: [] });
