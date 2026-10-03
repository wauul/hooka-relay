# Sentry verification — 2026-10-03

## Status

Implemented in this working tree and tested locally. Sentry EU organization `hooka-relay` and separate web/worker projects are configured. Vercel configuration and Railway runtime settings are saved. **The integration has not been deployed or committed/pushed.** Local `main` HEAD is `66d535019825c4395bce26df5a7a1a099e50d54e`; inspected Railway production uses `master` commit `db930057bb7bab657a9f1c2a06bfe14d6ef2adfa`. Reconcile the deployment branch before publishing this change, preserving unrelated working-tree changes.

Controlled errors use environment `development` and release `66d535019825c4395bce26df5a7a1a099e50d54e-sentry-verification`. This release denotes local verification, not a production deployment.

## Checks

| Check | Result |
| --- | --- |
| Unit suite | 38 files, 345 tests passed; includes privacy, navigation, isolation, deduplication, disabled configuration, failed transport and outbound-header restrictions |
| Integration suite | All 114 unique tests have passing results across the full run and targeted reruns. Initial full run: 109/113 passed; capacity transaction timeout and three RabbitMQ startup timeouts passed on rerun. Added Sentry delivery integration passed separately. |
| Failed Sentry transport delivery integration | Successful delivery, duplicate wakeup idempotency and lease release preserved against disposable PostgreSQL |
| Typecheck / lint | Passed |
| Next production build | Passed with actual web map upload; additional final-server upload handles maps emitted after webpack's upload hook |
| Worker compilation / Node 22 Docker | Passed; bootstrap, instrument, index, Prisma WASM and runtime dependencies present; nonroot runtime; no development packages or shipped maps |
| Worker fatal startup | Actual compiled bootstrap captured a controlled missing-key failure, flushed and exited 1 |
| Lockfiles | npm, pnpm and separate worker runtime locks updated; pnpm frozen-lockfile check passed |
| Credentials / artifacts | Browser assets and exported image layers scanned against the actual build-token bytes: no matches. No public browser maps. |
| Dependency audit | Worker runtime: zero vulnerabilities. Root: eight vulnerabilities (seven high, one low), identical to the pre-change HEAD baseline; existing audit CI gate remains a release blocker. |

## Actual receipts and privacy

- [Browser error](https://hooka-relay.sentry.io/issues/151111651/): real browser SDK initialized by `instrumentation-client.ts` in a local bundled harness. `/docs`, `service=browser`, development verification release; readable `lib/sentry-privacy.ts:28:37` frame and local harness frame. This is not a deployed Next page receipt.
- [Compiled worker startup error](https://hooka-relay.sentry.io/issues/151113864/): real Node 22 image bootstrap, `service=worker`, `operation=worker.fatal`; readable `lib/secrets.ts:9:45`, `worker/index.ts:20:14` and `worker/bootstrap.ts:6:7`, with TypeScript source excerpts.
- [Worker delivery-scope error](https://hooka-relay.sentry.io/issues/151110777/): safe opaque delivery ID, attempt and generation metadata; readable privacy helper frame. SDK transport confirmed both event and transaction HTTP 200. Concurrent test errors and transactions share their own trace IDs without cross-job context leakage.
- [Compiled Next server error](https://hooka-relay.sentry.io/issues/151116362/): invokes the actual applications GET handler outside a Next request context, producing a controlled caught framework error and HTTP 200 ingestion. It uses built instrumentation and route artifacts, not a public crash endpoint. Verified readable `lib/access.ts:10:41` (`userId`) and `app/api/applications/route.ts:9:23` (`GET`), with TypeScript source excerpts, correct development release and `service=web`. Earlier pre-fix receipts intentionally remain as verification history and are not mapping proof.

Next server maps required explicit `serverSourceMaps` and a final upload after Next emitted additional maps. The final step pairs these maps with webpack's existing debug ID; a second CLI injection would produce competing IDs. Sanitized matching `abs_path` and artifact paths support resolution without leaking filesystem roots or request URLs. Browser maps are removed from static output afterward. Server maps remain private function artifacts because Next file traces reference them; public access must return 404.

Exception values are replaced by a fixed diagnostic string. Request/user/extra/SQL/headers/body data is absent; dynamic transaction paths are normalized. Source-map frame paths contain only sanitized application artifact paths, including the matching `abs_path` needed for debug-ID resolution. Sentry can infer coarse geography from the ingest connection despite the application supplying no location or user profile.

The local browser harness observed zero events on an initially private route, one after entering a public route, no increment after navigating into a private route and triggering another error, and another event after returning to a public route. Tests additionally cover pending navigation and back/forward checks. Replay/profiling/screenshots/logs are disabled. The browser harness and temporary triggers were removed after verification; no crash API was added.

## External configuration and remaining release work

The approved `hooka-relay-builds` organization token (`org:ci`) is securely stored locally in an ignored file and as a sensitive Vercel production/preview variable. It is absent from Git, browser bundles, Docker arguments, runtime worker settings, image layers and this report. Vercel DSNs/project/sampling/disable settings cover production, preview and development. Railway runtime DSN/project/environment/sampling/disable/monitor settings were saved with deployment skipped.

[Production alert](https://hooka-relay.sentry.io/monitors/alerts/1328477/) connects both projects, filters exactly `environment=production`, catches new/regressed/high-priority issues and uses the existing notification destination with a 30-minute per-issue throttle. The redundant default web rule is disabled. Organization privacy settings require scrubbers, enhanced privacy, prevent future IP storage and disable remote source fetching.

[Maintenance monitor](https://hooka-relay.sentry.io/monitors/2349287/) received one successful **configuration-only** check-in. It is disabled until deployment: 30-minute interval, ten-minute margin, two-minute maximum run time, two consecutive failures and one-success recovery. The local setup check-in does not prove production maintenance execution.

Exact remaining steps:

1. Reconcile this working tree with the branch actually deployed and resolve the existing dependency-audit gate. Run normal CI on the resulting deployment commit.
2. Add repository Actions secret `SENTRY_AUTH_TOKEN` through an authorized GitHub session. No authenticated GitHub CLI/secret API or registry publishing credential was available here. The provided manual `worker-release.yml` builds only on trusted `main`/`master`, supplies the token as a BuildKit secret and publishes `ghcr.io/wauul/hooka-relay-worker:<Git SHA>`.
3. Configure Railway to pull that immutable image/digest, including private GHCR pull credentials if needed; start `node dist/worker/bootstrap.js`, set `SENTRY_RELEASE` to the image's Git SHA and retain the saved runtime settings. Do not pass the token through ordinary Docker ARGs or Railway runtime variables.
4. Deploy the matching Vercel commit with the saved sensitive build token and the same release SHA. Confirm web/server and worker source-map receipts for this deployed release.
5. Enable the saved maintenance monitor after the new worker is running; verify an actual successful maintenance check-in and a controlled access-restricted production smoke error, plus browser → server → persisted queue → worker trace continuity. Production broker continuity, serverless flushing and real alert delivery remain unverified until then.

There are no actual Edge routes today; future Edge initialization is prepared. Existing Grafana metrics and filtered traces remain on the single provider, with independent export sampling. No automatic customer SDK telemetry or propagation to customer webhook destinations was added.

Rollback: set server/worker `SENTRY_DISABLED=true`; set browser `NEXT_PUBLIC_SENTRY_DISABLED=true` and rebuild/redeploy. Zero sampling enables error-only mode. Pause the maintenance monitor during rollback and restore previous web/worker artifacts if necessary. See [operations](sentry.md) for ownership, sampling, quotas, credential rotation and deployment commands.
