# Sentry production verification — 2026-10-03

At verification time, the web application and worker were deployed at **`4d10d31614aecfe3c892094cc42b0482702e0733`**, and local `main`, GitHub `main` and GitHub `master` shared that commit. The five unrelated contact-email edits were preserved during deployment and committed afterward with this report. This report supersedes the release blockers in the earlier local verification record and records the deployment checks performed before that later commit.

## Deployment and configuration

| Item | Verified result |
| --- | --- |
| Vercel production | READY, deployment `dpl_EwvxW4nr5bRWxpFzrqiz2hwZa7Zn`, matching Git SHA, alias `hooka-relay.com` |
| Web deployment URL | https://hooka-relay-r55jsx3jj-wauuls-projects.vercel.app |
| Worker release workflow | [Successful image publish](https://github.com/wauul/hooka-relay/actions/runs/37133126158) |
| Immutable worker image | `ghcr.io/wauul/hooka-relay-worker@sha256:4366d11a14a2d6fff8bc03edf94a410fcddbbe03c475ad1ac43dbdc2fffb3263` |
| Registry access | Anonymous manifest access returned 200; no new registry credential required |
| Railway production | SUCCESS, deployment `10154ca3-e819-4896-80a8-d3a01ceb2434`, exact immutable image, no start-command override |
| Image runtime | Node `v22.23.3`, Sentry `10.76.0`, UID 1000, command `node dist/worker/bootstrap.js`, matching embedded/runtime release |
| GitHub build secret | Approved `SENTRY_AUTH_TOKEN` stored as repository Actions secret; credential-free ordinary CI preserved |
| Vercel build secret | Existing approved sensitive production/preview build variable used successfully |
| Railway runtime | Saved worker DSN, production environment, 5% trace sampling, disable switch and maintenance slug retained; runtime release set to deployed SHA; no Sentry upload token |

Railway's old repository source was disconnected before `master` advanced. The running worker remained available until replacement. Railway now consumes the published image; future worker releases require the trusted manual workflow and an explicit update to the new immutable digest and release value. A GitHub push alone no longer deploys the worker.

## Checks and actual Sentry receipts

- Full CI passed on the [release branch](https://github.com/wauul/hooka-relay/actions/runs/37132595944), [main](https://github.com/wauul/hooka-relay/actions/runs/37133070484), and [master](https://github.com/wauul/hooka-relay/actions/runs/37133113203). This includes frozen pnpm installation, SDK checks, security gates, lint, typecheck, unit/integration tests, coverage thresholds, Next build, Docker build and nonroot runtime smoke checks.
- Root and worker production dependency audits report zero vulnerabilities. The whole-tree gate has an exact, development-only exception for the unpatched `braces` advisory, expiring **2026-11-03 UTC**. It fails on an unrelated advisory, production instance, changed version or expiry. See [dependency-security.md](dependency-security.md). This is not a clean unrestricted root audit.
- Production homepage and documentation returned HTTP 200. The authenticated existing dashboard loaded successfully with zero applications; no temporary application, API key, signing secret, endpoint or delivery fixture was created.
- Worker readiness returned HTTP 200 and `worker ready`; startup logs showed the existing RabbitMQ topology ready. The exact published image passed asset/dependency/nonroot/map checks.
- The Vercel production build logged `Final Next server source maps uploaded`. The worker publish logged `Worker source maps uploaded for configured release`. The first preview's packaging failure was fixed by retaining private server maps referenced by Next file traces; public browser maps are still removed.
- Public server-map request `/_next/server/chunks/2357.js.map` returned 404. A discovered production browser chunk's `.js.map` request returned 403 with no map body. Maps were not publicly served.
- Scanned the complete exported published image (132,359,168 bytes), including 17,830 files from its decoded layers/archives, and 17 fetched production browser bundles against the actual approved token bytes: **zero matches**. The temporary image export and scan helper were removed.
- [Production web trace](https://hooka-relay.sentry.io/explore/traces/trace/af71d157b04e73814c7ee0a657a14157/): `next.request`, status `ok`, `service=web`, environment `production`, exact deployed release and Next.js SDK `10.76.0`.
- [Production worker trace](https://hooka-relay.sentry.io/explore/traces/trace/40fe75078412f5bfd85cca3917eecc97/): `worker.notices` with child `db.OperationalNotice.findMany`, status `ok`, `service=worker`, environment `production`, exact deployed release and Node SDK `10.76.0`. Inspected attributes contained operation identifiers and timings, not payloads, SQL parameters, receiver URLs or credentials. Sentry independently adds coarse geography inferred from the server connection.
- [Maintenance monitor](https://hooka-relay.sentry.io/monitors/2349287/) enabled after the new worker was healthy. Restarted the same deployment once to observe its immediate sweep. Actual production check-in **`1f114c5e`** started at **15:29:26 UTC**, completed at **15:29:28 UTC**, status **Okay**. The next check-in is scheduled 30 minutes later. The two historical ingestion notices say `Monitor disabled` and came from the first sweep before enablement; they are not maintenance failures. The earlier `d6ac6478` setup-only check-in remains historical evidence.
- The [production alert](https://hooka-relay.sentry.io/monitors/alerts/1328477/) remains connected to both projects with the production filter and existing email destination. No new notification recipients were added.

## Verification limits

The user explicitly chose **“Deploy without this live delivery test.”** No synthetic production event was accepted or delivered. Full browser → server → persisted queue → production worker → receiver trace continuity therefore remains unverified. Browser/server/worker error ingestion and readable TypeScript source mapping were verified locally earlier; the production release's artifact uploads, normal web/worker traces and real maintenance receipt were verified here. A new controlled production error and actual alert-email delivery were not induced or verified. These limits do not change the observed deployment/health results.

Earlier source-mapped local receipts: [browser](https://hooka-relay.sentry.io/issues/151111651/), [Next server](https://hooka-relay.sentry.io/issues/151116362/), [compiled worker startup](https://hooka-relay.sentry.io/issues/151113864/). They use the distinct development verification release and are not production-error receipts.

## Rollback

Set `SENTRY_DISABLED=true` on server/worker; set `NEXT_PUBLIC_SENTRY_DISABLED=true` and rebuild/redeploy the web application. Pause the maintenance monitor during rollback. Zero trace sampling retains error reporting. If application behavior regresses, restore the previous Vercel deployment (`hooka-relay-4n00ihmkn-wauuls-projects.vercel.app`, commit `66d535019825c4395bce26df5a7a1a099e50d54e`) and previous Railway deployment (`cd12ac34-9d2e-414b-a2a4-bcdc0666a392`, commit `db930057bb7bab657a9f1c2a06bfe14d6ef2adfa`) using the providers' rollback flow. Preserve Grafana settings independently. See [sentry.md](sentry.md) for privacy, sampling, ownership and credential rotation.
