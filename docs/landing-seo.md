# Landing page search positioning

Primary intent: **webhook delivery service for SaaS teams**. Related terms used where they describe actual capabilities: outbound webhooks, signed webhooks, webhook retries, delivery logs, failure investigation, replay.

The homepage, documentation, privacy and terms pages are the only sitemap entries. Other pages receive `X-Robots-Tag: noindex, nofollow` from the Next.js proxy, including the changing service status view, authenticated routes, signup and login, password and verification flows, invitation links and customer portal links. Robots, sitemap and preview image files remain crawlable. The robots file permits crawling so crawlers can observe private-page response headers. The homepage canonical resolves to `https://hooka-relay.vercel.app` (equivalent to the root URL with a trailing slash).

The English and French interface preference currently uses the same URL and a cookie. The server renders the cookie-selected language, while the browser toggle changes it without navigation. There is no `hreflang` because there are no separate stable language URLs. For multilingual search later, create crawlable `/en/` and `/fr/` routes with complete translated content, self canonicals and reciprocal `hreflang` links before advertising French as a search language.

The main repository has no root license, so the landing page does not call the hosted service open source. The current Terms of Use say the hosted service is free and subject to resource limits, but the landing page does not turn that current term into an enduring pricing promise. No structured data was added: the present service information is already clear in visible page copy and metadata.

After release, the site owner can verify the production domain in Google Search Console and submit `https://hooka-relay.vercel.app/sitemap.xml`. Indexing and search performance must be checked there after deployment.
