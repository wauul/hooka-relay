import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const providerNames = ["STRIPE", "GITHUB", "SLACK", "SHOPIFY", "TWILIO", "WOOCOMMERCE", "CUSTOM"] as const;
export type ProviderName = typeof providerNames[number];
export const manualVerifierSchema = z.object({
  signatureHeader: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  algorithm: z.enum(["sha256", "sha1"]),
  encoding: z.enum(["hex", "base64"]),
  signaturePrefix: z.string().max(32).default(""),
  timestampHeader: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
  signedPayload: z.enum(["body", "timestamp-body"]).default("body"),
  timestampFormat: z.string().max(100).optional(),
}).superRefine((value, ctx) => {
  if (value.signedPayload === "timestamp-body" && (!value.timestampHeader || !value.timestampFormat?.includes("{body}") || !value.timestampFormat.includes("{timestamp}")))
    ctx.addIssue({ code: "custom", message: "Timestamp signing requires a header and a format containing {timestamp} and {body}." });
});
export type ManualVerifier = z.infer<typeof manualVerifierSchema>;
export type VerificationRequest = { rawBody: Buffer; headers: Headers; secret: string; url: string; now?: number; manualConfig?: ManualVerifier };
export type WebhookProviderAdapter = {
  name: ProviderName;
  displayName: string;
  icon: string;
  docsUrl: string;
  setupInstructions: string[];
  testEventSupport: boolean;
  verifySignature(request: VerificationRequest): boolean;
  eventId(payload: unknown, headers: Headers): string | null;
  eventType(payload: unknown, headers: Headers): string;
};
function equal(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function timestamp(value: string | null, now = Date.now()) {
  if (!value || !/^\d{10}$/.test(value)) return false;
  return Math.abs(now / 1000 - Number(value)) <= 300;
}
function jsonField(payload: unknown, key: string) {
  return payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>)[key] === "string"
    ? (payload as Record<string, string>)[key] : null;
}
function hmac(algorithm: "sha256" | "sha1", secret: string, body: string | Buffer, encoding: "hex" | "base64") {
  return createHmac(algorithm, secret).update(body).digest(encoding);
}
export function verifyManual(request: VerificationRequest) {
  const config = request.manualConfig;
  if (!config) return false;
  const supplied = request.headers.get(config.signatureHeader);
  if (!supplied || !supplied.startsWith(config.signaturePrefix)) return false;
  let body: string | Buffer = request.rawBody;
  if (config.signedPayload === "timestamp-body") {
    const time = request.headers.get(config.timestampHeader!);
    if (!timestamp(time, request.now)) return false;
    body = config.timestampFormat!.replaceAll("{timestamp}", time!).replaceAll("{body}", new TextDecoder("utf-8", { fatal: true }).decode(request.rawBody));
  }
  return equal(supplied.slice(config.signaturePrefix.length), hmac(config.algorithm, request.secret, body, config.encoding));
}
export const providers: Record<ProviderName, WebhookProviderAdapter> = {
  STRIPE: {
    name: "STRIPE", displayName: "Stripe", icon: "S", docsUrl: "https://docs.stripe.com/webhooks",
    setupInstructions: ["In Stripe Workbench, open Webhooks and add an event destination.", "Paste the Hooka Relay ingestion URL and choose the event types you need.", "Reveal that destination's whsec_ signing secret and paste it here.", "Send a test event from Stripe Workbench."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret, now }) => {
      const parts = (headers.get("stripe-signature") || "").split(",").map(part => part.trim());
      const time = parts.find(part => part.startsWith("t="))?.slice(2) || null;
      if (!timestamp(time, now)) return false;
      const expected = hmac("sha256", secret, `${time}.${rawBody.toString("utf8")}`, "hex");
      return parts.some(part => part.startsWith("v1=") && equal(part.slice(3), expected));
    },
    eventId: payload => jsonField(payload, "id"), eventType: payload => jsonField(payload, "type") || "stripe.event",
  },
  GITHUB: {
    name: "GITHUB", displayName: "GitHub", icon: "G", docsUrl: "https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks",
    setupInstructions: ["Open your repository or organization Settings → Webhooks → Add webhook.", "Paste the Hooka Relay ingestion URL as the Payload URL and select application/json.", "Enter a new random webhook secret and paste the same value here.", "Choose events and use GitHub's recent deliveries to redeliver a test."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret }) => {
      const supplied = headers.get("x-hub-signature-256");
      return !!supplied && equal(supplied, `sha256=${hmac("sha256", secret, rawBody, "hex")}`);
    },
    // GitHub signs the body, not X-GitHub-Delivery; hash the signed body for deduplication.
    eventId: () => null, eventType: (_payload, headers) => `github.${headers.get("x-github-event") || "event"}`,
  },
  SLACK: {
    name: "SLACK", displayName: "Slack", icon: "#", docsUrl: "https://docs.slack.dev/authentication/verifying-requests-from-slack/",
    setupInstructions: ["Open your Slack app and enable Event Subscriptions.", "Paste the Hooka Relay ingestion URL as the Request URL.", "Copy the Signing Secret from Basic Information into Hooka Relay.", "Save a subscription and trigger an event in your development workspace."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret, now }) => {
      const time = headers.get("x-slack-request-timestamp");
      const supplied = headers.get("x-slack-signature");
      return timestamp(time, now) && !!supplied && equal(supplied, `v0=${hmac("sha256", secret, `v0:${time}:${rawBody.toString("utf8")}`, "hex")}`);
    },
    eventId: payload => jsonField(payload, "event_id"), eventType: payload => `slack.${jsonField(payload, "type") || "event"}`,
  },
  SHOPIFY: {
    name: "SHOPIFY", displayName: "Shopify", icon: "S", docsUrl: "https://shopify.dev/docs/apps/build/webhooks/verify-deliveries",
    setupInstructions: ["Create an app webhook subscription for the topics you need.", "Set its delivery URL to the Hooka Relay ingestion URL.", "Copy your app's client secret into Hooka Relay.", "Trigger a test delivery from your development store."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret }) => {
      const supplied = headers.get("x-shopify-hmac-sha256");
      return !!supplied && equal(supplied, hmac("sha256", secret, rawBody, "base64"));
    },
    // Shopify's HMAC covers the body; an unsigned ID header must not bypass deduplication.
    eventId: () => null, eventType: (_payload, headers) => `shopify.${headers.get("x-shopify-topic") || "event"}`,
  },
  TWILIO: {
    name: "TWILIO", displayName: "Twilio", icon: "T", docsUrl: "https://www.twilio.com/docs/usage/webhooks/webhooks-security",
    setupInstructions: ["Open the Twilio console for the number or service sending webhooks.", "Paste the Hooka Relay ingestion URL into its webhook URL setting.", "Copy your Twilio account Auth Token into Hooka Relay.", "Trigger a request using your Twilio development account."], testEventSupport: false,
    verifySignature: ({ rawBody, headers, secret, url }) => {
      const supplied = headers.get("x-twilio-signature");
      if (!supplied) return false;
      const parsed = new URL(url);
      let base = url;
      if (headers.get("content-type")?.startsWith("application/json")) {
        const bodyHash = parsed.searchParams.get("bodySHA256");
        if (!bodyHash || !equal(bodyHash, createHash("sha256").update(rawBody).digest("hex"))) return false;
      } else if (headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams(rawBody.toString("utf8"));
        const names = [...params.keys()];
        if (new Set(names).size !== names.length) return false;
        for (const name of names.sort()) base += name + params.get(name);
      } else return false;
      return equal(supplied, hmac("sha1", secret, base, "base64"));
    },
    eventId: payload => jsonField(payload, "MessageSid") || jsonField(payload, "CallSid"), eventType: payload => `twilio.${jsonField(payload, "EventType") || "event"}`,
  },
  WOOCOMMERCE: {
    name: "WOOCOMMERCE", displayName: "WooCommerce", icon: "W", docsUrl: "https://woocommerce.com/document/webhooks/",
    setupInstructions: ["Go to WooCommerce → Settings → Advanced → Webhooks and create a webhook.", "Choose a topic and paste the Hooka Relay ingestion URL as the Delivery URL.", "Enter a new secret, save the webhook, and enter that same secret here.", "Send a ping or trigger the selected topic from your store."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret }) => {
      const supplied = headers.get("x-wc-webhook-signature");
      return !!supplied && equal(supplied, hmac("sha256", secret, rawBody, "base64"));
    },
    eventId: () => null, eventType: (_payload, headers) => `woocommerce.${headers.get("x-wc-webhook-topic") || "event"}`,
  },
  CUSTOM: {
    name: "CUSTOM", displayName: "Custom / Manual", icon: "+", docsUrl: "https://hooka-relay.vercel.app/docs#signatures",
    setupInstructions: ["Find your provider's webhook settings and create a new destination.", "Paste the Hooka Relay ingestion URL.", "Configure the signature header and algorithm exactly as the provider documents.", "Paste the provider signing secret and send a real test event."], testEventSupport: false,
    verifySignature: verifyManual,
    eventId: () => null, eventType: () => "custom.event",
  },
};

// PayPal uses RSA certificate verification or an authenticated server-to-server
// verify-webhook-signature API call with a registered webhook ID. It is not a
// local HMAC provider and is deliberately absent until that flow is implemented.
