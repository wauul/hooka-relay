# Authentication and transactional email

## OAuth setup
GitHub: create an OAuth app at https://github.com/settings/developers, homepage `https://hooka-relay.vercel.app`, callback `https://hooka-relay.vercel.app/api/auth/callback/github`. Use a separate development OAuth app with `http://localhost:3000/api/auth/callback/github`. Set `GITHUB_ID` and `GITHUB_SECRET` in the server environment.

Google: create a Web application OAuth client in Google Cloud Console. Register origins `https://hooka-relay.vercel.app` and `http://localhost:3000`; callbacks `https://hooka-relay.vercel.app/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Testing mode add test users; production sign-in requires publishing the consent configuration. Only identity/email/profile scopes are requested, with no billing requirement.

NextAuth retains its standard account-linking protection. A logged-out OAuth identity sharing an existing account email receives `OAuthAccountNotLinked`. Sign in using the existing method, then select Link GitHub/Google under Your profile. No automatic email-based merging is enabled. Google must assert `email_verified`; GitHub must report a verified primary email via its email API. We store the provider/account identifier only, never OAuth access or refresh tokens.

## Verification and recovery
Existing accounts are grandfathered by the additive migration so current integrations and login access remain available. This is a compatibility allowance, not evidence that those historical addresses were verified by an email challenge. New credentials accounts start unverified. Verification links expire after 24 hours; password reset links after 30 minutes. Tokens are random 256-bit capabilities stored only as SHA-256 hashes, consumed atomically on POST. Opening a link does not consume it (email scanners cannot confirm/reset an account). Invite review destinations survive verification.

Forgot-password and resend responses do not disclose account existence. Account email routes have a dedicated per-IP budget (`RECOVERY_IP_LIMIT_PER_MINUTE`, default 5), plus a shared per-address/purpose 60-second send cooldown. Resends do not revoke earlier unused links. Password reset revokes all account recovery links and previous JWT sessions, including their use for OAuth linking. NextAuth CSRF remains enabled; new POST routes require same-origin when an Origin header is present and bounded JSON input.

## Email templates
`lib/transactional-email.ts` renders reusable React elements with React Email's renderer, using the app's charcoal/mint palette, a wordmark, one primary CTA and a text fallback. It is shared by verification, password reset, workspace invites and endpoint-disabled alerts. No marketing messages are sent; transactional footers explain why the message was received. `RESEND_REPLY_TO` should point to a monitored inbox; the verified From address remains `Hooka Relay <invites@waelfz.com>`.

## Deliverability investigation — 2026-09-22
Live DNS and Resend API checks found:

| Check | Finding |
| --- | --- |
| Custom sending domain | `waelfz.com`, verified in Resend; not the shared sandbox domain |
| DKIM | `resend._domainkey.waelfz.com` published; Resend status verified |
| SPF | `send.waelfz.com` has `include:amazonses.com`; return-path MX verified. Root SPF is for Cloudflare mail routing, and is not the envelope sender used by Resend. Do not add a second SPF record. |
| DMARC | `_dmarc.waelfz.com` published with `p=none` and aggregate-report address. Monitoring mode is valid; enforcement is not an inbox-placement guarantee. |
| From | `invites@waelfz.com`, matches the verified domain. DNS alone cannot establish that this mailbox is monitored. |
| Content | Existing subjects were descriptive, without excessive urgency, capitals or punctuation. Existing messages were text-only and had no Reply-To; those are improved, but not proven causes of spam placement. |

No missing SPF/DKIM/DMARC record was found, so no registrar change is currently justified. Do not tighten DMARC until reports confirm alignment for every legitimate sender. Domain/IP reputation, recipient filtering and engagement can still affect placement. A delivered message's Authentication-Results headers and recipient spam-folder observation are required before claiming a root cause or a fix to inbox placement. Templates alone do not guarantee deliverability.
