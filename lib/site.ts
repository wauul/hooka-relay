export const faq = [
  {
    question: "What happens when my endpoint goes offline?",
    answer:
      "Accepted events remain in the durable outbox. Hooka Relay retries failed deliveries up to five total attempts, with delays of 30 seconds, 2 minutes, 5 minutes and 15 minutes.",
  },
  {
    question: "Can I receive the same event twice?",
    answer:
      "Yes. Delivery is at least once. Store the X-Idempotency-Key atomically with your business operation and return a successful response for a previously processed event.",
  },
  {
    question: "Why is my circuit breaker open?",
    answer:
      "Five consecutive endpoint failures open the circuit. After ten minutes, one recovery request tests the endpoint. A success closes it; another failure restarts the cooldown.",
  },
  {
    question: "How do I verify a webhook signature?",
    answer:
      "Compute a SHA-256 HMAC over the exact raw request body with your endpoint signing secret. Compare it to X-Webhook-Signature using a timing-safe comparison.",
  },
  {
    question: "Can I work from my terminal?",
    answer:
      "Install hooka-relay-cli from npm, run hooka login, then use hooka send, hooka tail and hooka replay. The CLI uses your Application API key.",
  },
  {
    question: "Which cookies does Hooka Relay use?",
    answer:
      "Essential cookies keep you signed in and protect authentication requests. This site does not load advertising or optional analytics cookies. Your banner dismissal is stored locally in your browser.",
  },
];
export type SearchResult = {
  title: string;
  description: string;
  href: string;
  category: string;
};
export const siteIndex: SearchResult[] = [
  {
    title: "Applications",
    description: "Workspace dashboard, API keys and registered endpoints",
    href: "/dashboard",
    category: "Page",
  },
  {
    title: "Sign in",
    description: "Access your webhook workspace",
    href: "/login",
    category: "Page",
  },
  {
    title: "Create an account",
    description: "Register for Hooka Relay",
    href: "/signup",
    category: "Page",
  },
  ...[
    [
      "Send an event",
      "send",
      "Use curl to POST an event type and JSON payload to the API. Accepted events return 202; the payload limit is 256 KB.",
    ],
    [
      "Verify the signature",
      "signatures",
      "Authenticate raw request bytes with your signing secret and an HMAC SHA-256 signature.",
    ],
    [
      "Make receivers idempotent",
      "idempotency",
      "Handle duplicate deliveries and replay safely using an idempotency key and atomic deduplication.",
    ],
    [
      "Retries & circuit breaking",
      "retries",
      "Understand RabbitMQ retry delays, the durable outbox, dead-letter delivery and CLOSED, OPEN or HALF_OPEN circuits.",
    ],
    [
      "Demo receivers",
      "receivers",
      "Test succeed, fail, hang and flaky endpoint modes, including timeouts.",
    ],
    [
      "Failure diagnosis",
      "diagnosis",
      "Use Groq AI to investigate delivery errors, HTTP status codes and response bodies.",
    ],
    [
      "API reference",
      "api-reference",
      "Explore application, endpoint and event routes with API key or session authentication.",
    ],
    [
      "Command-line companion",
      "cli",
      "Install hooka-relay-cli with npm. Login, send, tail and replay events from your terminal.",
    ],
  ].map(([title, anchor, description]) => ({
    title,
    description,
    href: `/docs#${anchor}`,
    category: "Documentation",
  })),
  ...faq.map((item, i) => ({
    title: item.question,
    description: item.answer,
    href: `/docs#faq-${i}`,
    category: "FAQ",
  })),
];
export function searchSite(query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return siteIndex
    .filter((item) =>
      terms.every((term) =>
        `${item.title} ${item.description}`.toLowerCase().includes(term),
      ),
    )
    .slice(0, 12);
}
// Only navigation links receive campaign attribution. Never alter webhook
// destinations, API calls, authentication redirects, mailto links or code samples.
export function outboundUrl(href: string) {
  if (!/^https?:\/\//i.test(href)) return href;
  const url = new URL(href);
  if (url.origin === "https://hooka-relay.vercel.app") return href;
  for (const [key, value] of Object.entries({
    utm_source: "hooka_relay",
    utm_medium: "website",
    utm_campaign: "developer_resources",
  }))
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return url.toString();
}
