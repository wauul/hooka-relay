# Sentry operations

Hooka Relay uses the EU `hooka-relay` organization, `hooka-relay-web` for Next.js/browser errors, and `hooka-relay-worker` for the Node worker. The existing organization owner is the operational owner; alerts retain Sentry's existing Suggested Assignees / Recently Active Members email destination. No recipient is added.

## Runtime and privacy

Sentry 10.76.0 is pinned consistently across the Next.js app and worker runtime. This supported SDK line provides `sendDefaultPii: false`, custom OpenTelemetry setup, Next.js 16 request/navigation hooks, and source-map debug IDs. SDK 11 changes the privacy and custom-sampler APIs; upgrade all Sentry packages together with a fresh privacy/OTel review.

`instrumentation.ts` loads server configuration; `instrumentation-client.ts` handles browser initialization and navigation; React boundaries capture client render failures while server digests avoid duplicate capture. The existing APIs and caught infrastructure failures report through `reportUnexpected`. The worker's CommonJS `bootstrap.js` loads `instrument.js` before requiring application code, captures startup failures, and preserves nonzero fatal exits. Jobs and WebSocket handlers use isolated scopes.

`lib/sentry-privacy.ts` constructs new allowlisted events. Free-form exception messages, request/body/header/cookie data, user data, SQL, receiver URLs, breadcrumbs from DOM/HTTP/console/navigation, and custom metadata are removed. Only source filenames/coordinates, safe operation names, opaque correlation IDs, attempts/generations, outcome, release/environment, and trace IDs survive. Source maps contain application code, so their Sentry download access remains restricted to organization administrators. Replay, screenshots, profiling, structured logs, automatic SQL/HTTP instrumentation and request-body capture are disabled. Customer Node/Python SDKs remain independent of Sentry.

Browser events and transactions are blocked both on current capability-page locations and pending navigation destinations (portal, invitations, recovery/password-reset/email-verification). Browser back/forward is checked again at send time. Dynamic route segments become `[id]`; queries and origins are removed. The same capability filter strengthens Vercel analytics/privacy middleware.

Sentry organization settings additionally require default/server-side data scrubbing, prevent IP storage for future events, enable enhanced privacy, and disable JavaScript source fetching. These settings supplement the application allowlist; do not weaken either layer. Ingest infrastructure can infer coarse location from a connection; the application does not send a user profile or location.

Expected validation/authentication failures, invalid signatures and normal receiver non-2xx/retry outcomes remain metrics and operational state, rather than issues. Error objects crossing boundaries are deduplicated. Repeated worker/broker infrastructure failures are bounded to one report per safe operation per minute. Grouping combines Sentry's source-stack grouping with the operation, so distinct defects are not collapsed solely by redacted messages.

## Traces and Grafana

A single `NodeTracerProvider` uses Sentry's context manager, propagator, sampler and span processor when Sentry is enabled. Grafana retains its existing filtered OTLP processor and metric reader. No second provider or automatic outbound instrumentation is installed. Grafana and Sentry export ratios are independently enforced using deterministic trace-ID sampling. Errors are independent of trace sampling. Existing `Event.traceparent` persistence continues across durable enqueue and delivery processing; attempt and generation distinguish retry/replay work.

Representative spans cover Next request roots, ingestion, query model/operation names, outbox publishing, maintenance, and delivery. Database query spans exclude all arguments and do not independently report expected duplicate-key exceptions. Browser propagation targets same-origin internal API paths; outbound delivery explicitly strips `sentry-trace`, `baggage`, `traceparent`, and `tracestate` before sending to customer receivers. Next serverless `after()` flush and worker shutdown continue flushing both backends. Worker shutdown has a ten-second absolute deadline; early fatal bootstrap capture has a 2.5-second deadline.

There are no actual Edge routes today. The Edge configuration is ready for explicit future routes, but Node/Grafana custom setup does not run in Edge. Automatic browser/server/queue trace continuity is feasible for requests receiving valid framework trace context; persisted W3C ingestion-to-worker continuity is tested. End-to-end continuity of a deployed browser request through the real production broker must still be checked after deployment.

## Environment configuration

Use `.env.example` for names and descriptions. DSNs are public ingestion identifiers. `SENTRY_AUTH_TOKEN` is an approved `org:ci` organization build token, never a browser variable, Docker build argument, Git file, or log value. Runtime code does not read this credential. Vercel stores it as a sensitive production/preview environment variable; Railway runtime does not receive it.

| Setting | Web | Worker |
| --- | --- | --- |
| DSN | `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` | `SENTRY_WORKER_DSN` |
| Environment | `SENTRY_ENVIRONMENT`; browser value forwarded from the build | `SENTRY_ENVIRONMENT` |
| Release | `SENTRY_RELEASE`, falling back to `VERCEL_GIT_COMMIT_SHA` | image build/runtime `SENTRY_RELEASE`, falling back to Railway Git metadata |
| Error disable | `SENTRY_DISABLED=true` and `NEXT_PUBLIC_SENTRY_DISABLED=true` | `SENTRY_DISABLED=true` |
| Trace ratio | server/public `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | `SENTRY_TRACES_SAMPLE_RATE` |

Use `development` locally, `preview` (or explicitly `staging`) on isolated non-production deployments, and `production` on live services. Vercel's environment is the fallback for both web/server and browser builds. The Railway production worker has explicit production configuration; an isolated preview worker must use its own environment and disposable database/broker. Both services must report the exact same deployed Git SHA. Verification runs use a deliberately distinct `SHA-sentry-verification` development release, which is not a deployed production release.

Default Sentry trace sampling is 5%; Grafana remains at its existing 10% default. Missing DSNs disable capture without preventing startup. Setting trace ratios to zero retains error reporting. Use Sentry Stats & Usage and spike protection to watch event budgets; lower trace ratios first. Optional features require a new explicit privacy review and code changes: Replay/profiling/screenshots must not be enabled by merely adding an environment variable. Keep capability exclusion, strict masking/deny rules and tests when proposing any future enablement.

## Source maps and deployment

Web `withSentryConfig` uploads maps during a trusted build with `SENTRY_AUTH_TOKEN`, organization/project, and the deployed release SHA. Upload errors stop a credentialed build. Next emits additional server maps after the webpack hook. The final build step pairs debug IDs and uploads those exact server artifacts before removing browser maps. Server maps remain private function artifacts because Vercel packages files referenced by Next file traces; they are never served from the static asset directory. Credential-free builds also remove browser maps.

Both worker Dockerfiles are identical. Build with a BuildKit secret:

```sh
docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
  --build-arg SENTRY_RELEASE="$DEPLOYED_GIT_SHA" \
  --build-arg SENTRY_ORG=hooka-relay \
  --build-arg SENTRY_WORKER_PROJECT=hooka-relay-worker \
  -t hooka-relay-worker:"$DEPLOYED_GIT_SHA" .
```

The upload script injects debug IDs into the exact compiled artifacts shipped in the image, uploads maps with embedded TypeScript sources, and removes maps afterward. Never rebuild those files after upload. The runtime contains only the separate locked runtime dependency set, runs as `node`, and starts `node dist/worker/bootstrap.js`. `railway.json` now matches this command. Railway's inspected live deployment used its Docker CMD (no dashboard start override); deploying the new image is required before it runs the new bootstrap.

Credential-free PR CI builds without Sentry uploads and checks bootstrap/dependencies, absence of maps/build token, and nonroot execution. `.github/workflows/worker-release.yml` is manual and restricted to `main`/`master`. It uses GitHub Actions `SENTRY_AUTH_TOKEN` only as a BuildKit secret and publishes a SHA-tagged GHCR image. Before running, add that repository secret through an authorized GitHub session, pass normal CI, then use the immutable image/digest in Railway. Configure any required private GHCR pull access via Railway's registry integration. Do not set the Sentry build token as a Railway runtime variable or ordinary Docker ARG.

Vercel production/preview/development DSNs, project identifiers, ratios and disable switches are configured. The build token is stored as a Vercel sensitive production/preview variable. Railway's runtime DSN/project/environment/sampling/disable settings are configured without triggering deployment. GitHub secret/image-source setup and production deployment are separate from these saved settings.

## Alerts and maintenance

One shared rule connects both projects; the redundant all-environment web default alert is disabled. [Saved production rule](https://hooka-relay.sentry.io/monitors/alerts/1328477/) uses the existing Sentry email destination, an exact `environment=production` event condition, and a 30-minute per-issue notification throttle. Check saved rule details after changing settings; default project-created alerts otherwise include development events.

`SENTRY_MAINTENANCE_MONITOR=hooka-relay-maintenance` enables worker check-ins at most once per 30 minutes, including during busy five-second maintenance cycles. The SDK supplies an interval schedule of 30 minutes, ten-minute check-in margin, two-minute maximum run time, two consecutive failures before an issue, and one successful check-in to recover. The monitor has been created and received a configuration-only successful check-in, then was disabled to avoid alerts before deployment. [Saved monitor](https://hooka-relay.sentry.io/monitors/2349287/). Keep the production monitor disabled until the instrumented worker is deployed, then enable the matching runtime slug and verify one successful check-in. Multiple replicas share the service sweep; this monitor detects aggregate maintenance availability, not individual replica health. Railway health checks continue covering readiness.

## Rollback

Disable server/worker with `SENTRY_DISABLED=true`; disable browser with `NEXT_PUBLIC_SENTRY_DISABLED=true` and rebuild/redeploy because public configuration is compiled in. Set sample rates to zero for an error-only mode. Pause production alerts/maintenance monitor during a rollback. Redeploy the previous known-good web deployment and immutable worker image if runtime behavior changes. Grafana remains independently controlled by `OTEL_SDK_DISABLED` and its existing settings. Revoke/rotate the build token in Sentry and replace trusted build secrets if needed; no runtime code needs the upload token.

## References

- [Next.js manual setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/)
- [Node custom OpenTelemetry setup](https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/custom-setup/)
- [JavaScript SDK migration guidance](https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md)
- [Source maps](https://docs.sentry.io/platforms/javascript/sourcemaps/)
- [Advanced scrubbing](https://docs.sentry.io/product/data-management-settings/scrubbing/advanced-datascrubbing/)

