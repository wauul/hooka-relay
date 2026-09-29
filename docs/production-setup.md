# Production setup

The canonical app and API origin is **https://hooka-relay.com**. The domain is registered in Cloudflare and assigned to the `hooka-relay` Vercel project. Root and `www` DNS records target `5f16bde92075b891.vercel-dns-017.com` with DNS-only routing. Vercel manages HTTPS and redirects `www` to the root domain. Use Vercel's current recommended records if these values change.

Set `NEXTAUTH_URL=https://hooka-relay.com` in Vercel production and the Railway worker so authentication, invitations, verification, recovery and alert links use the same origin. Register `/api/auth/callback/github` and `/api/auth/callback/google` on this origin in the existing OAuth apps. Keep localhost callbacks in separate development clients where appropriate. The transactional sending domain remains the existing verified Resend domain; changing the website origin does not require changing email DNS.

On 2026-09-29, the test Neon database was replaced with the empty Free project `hooka-relay-production` (`sweet-night-52569955`), production branch `br-withered-band-b5awo0x8`, in AWS Ohio. All 22 existing migrations were applied. The application uses the restricted `hooka_runtime` login through the pooled endpoint; administrative credentials stay out of hosted app environments. Future migrations require the owner connection saved locally in the ignored `.env.neon-admin` file. No old test users, applications or events were copied; create a new account and integrations.

The old test project `little-glade-24415747` is retained. The worker now shares one maintenance window, checks every five seconds while known work remains, and backs off to a 30-minute safety sweep when idle. RabbitMQ wake hints bring new committed work forward. A lost hint may delay discovery up to 30 minutes. Hourly cleanup uses the same wake window. Live listeners and sustained pending work legitimately keep Postgres active. See the README's worker maintenance section for operational behavior.

Search setup and its limits are documented in [landing-seo.md](landing-seo.md).
