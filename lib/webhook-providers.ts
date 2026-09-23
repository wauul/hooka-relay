import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const providerNames = ["STRIPE", "GITHUB", "SLACK", "SHOPIFY", "TWILIO", "WOOCOMMERCE", "LINEAR", "SQUARE", "INTERCOM", "MAILGUN", "ZOOM", "FACEBOOK", "INSTAGRAM", "WHATSAPP", "TIKTOK", "LINKEDIN", "ZENDESK", "TYPEFORM", "PADDLE", "CUSTOM"] as const;
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
function metaAdapter(name: "FACEBOOK" | "INSTAGRAM" | "WHATSAPP", displayName: string): WebhookProviderAdapter {
  return {
    name, displayName, icon: displayName[0], docsUrl: "https://developers.facebook.com/docs/graph-api/webhooks/getting-started",
    setupInstructions: ["In Meta for Developers, open your app's Webhooks product.", "Enter this ingestion URL as the Callback URL and choose a Verify Token.", "Enter the same Verify Token and your Meta App Secret in Hooka Relay.", "Verify the callback, subscribe to the relevant fields, and send a test event."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret }) => {
      const supplied = headers.get("x-hub-signature-256");
      return !!supplied && equal(supplied, `sha256=${hmac("sha256", secret, rawBody, "hex")}`);
    },
    eventId: () => null, eventType: payload => `${name.toLowerCase()}.${jsonField(payload, "object") || "event"}`,
  };
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
  LINEAR: {
    name: "LINEAR", displayName: "Linear", icon: "L", docsUrl: "https://linear.app/developers/webhooks",
    setupInstructions: ["Open Linear Settings → API → Webhooks and create a webhook.", "Paste this ingestion URL and select the event types or team.", "Copy the webhook signing secret from its detail page and enter it here.", "Trigger an issue or project update to test."], testEventSupport: false,
    verifySignature: ({ rawBody, headers, secret, now }) => {
      const supplied = headers.get("linear-signature");
      if (!supplied || !equal(supplied, hmac("sha256", secret, rawBody, "hex"))) return false;
      try {
        const value = JSON.parse(rawBody.toString("utf8")) as { webhookTimestamp?: unknown };
        return typeof value.webhookTimestamp === "number" && Math.abs((now ?? Date.now()) - value.webhookTimestamp) <= 60_000;
      } catch { return false; }
    },
    eventId: () => null, eventType: (payload, headers) => `linear.${headers.get("linear-event") || jsonField(payload, "type") || "event"}`,
  },
  SQUARE: {
    name: "SQUARE", displayName: "Square", icon: "S", docsUrl: "https://developer.squareup.com/docs/webhooks/step3validate",
    setupInstructions: ["Open Square Developer Console → Webhooks and create a subscription.", "Paste this exact notification URL and select the events.", "Copy the subscription signature key into Hooka Relay.", "Send a test notification from Square."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret, url }) => {
      const supplied = headers.get("x-square-hmacsha256-signature");
      return !!supplied && equal(supplied, hmac("sha256", secret, url + rawBody.toString("utf8"), "base64"));
    },
    eventId: payload => jsonField(payload, "event_id"), eventType: payload => `square.${jsonField(payload, "type") || "event"}`,
  },
  INTERCOM: {
    name: "INTERCOM", displayName: "Intercom", icon: "I", docsUrl: "https://developers.intercom.com/docs/references/2.7/rest-api/webhooks/webhook-models",
    setupInstructions: ["Open your Intercom app's Webhooks settings.", "Use this ingestion URL and select the topics you need.", "Copy the app client secret from Basic Info and enter it here.", "Trigger one of the subscribed events."], testEventSupport: false,
    verifySignature: ({ rawBody, headers, secret }) => {
      const supplied = headers.get("x-hub-signature");
      return !!supplied && equal(supplied, `sha1=${hmac("sha1", secret, rawBody, "hex")}`);
    },
    eventId: payload => jsonField(payload, "id"), eventType: payload => `intercom.${jsonField(payload, "topic") || "event"}`,
  },
  MAILGUN: {
    name: "MAILGUN", displayName: "Mailgun", icon: "M", docsUrl: "https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks",
    setupInstructions: ["Open Mailgun → Sending → Webhooks for your domain.", "Add this ingestion URL for the event types you want.", "Copy the domain's Webhook Signing Key into Hooka Relay.", "Send a test webhook from Mailgun."], testEventSupport: true,
    verifySignature: ({ rawBody, secret, now }) => {
      try {
        const payload = JSON.parse(rawBody.toString("utf8")) as { signature?: { timestamp?: string; token?: string; signature?: string } };
        const signed = payload.signature;
        if (!signed?.token || !timestamp(signed.timestamp ?? null, now) || !signed.signature) return false;
        return equal(signed.signature, hmac("sha256", secret, signed.timestamp + signed.token, "hex"));
      } catch { return false; }
    },
    eventId: payload => payload && typeof payload === "object" ? jsonField((payload as Record<string, unknown>)["event-data"], "id") : null,
    eventType: payload => payload && typeof payload === "object" ? `mailgun.${jsonField((payload as Record<string, unknown>)["event-data"], "event") || "event"}` : "mailgun.event",
  },
  ZOOM: {
    name: "ZOOM", displayName: "Zoom", icon: "Z", docsUrl: "https://developers.zoom.us/docs/api/webhooks/",
    setupInstructions: ["Open your Zoom app's Event Subscriptions and enter this Event Notification Endpoint URL.", "Copy its Secret Token into Hooka Relay first, then run Zoom's URL validation.", "Select events and save the subscription.", "Trigger an event in your Zoom development account."], testEventSupport: false,
    verifySignature: ({ rawBody, headers, secret, now }) => {
      const time = headers.get("x-zm-request-timestamp"), supplied = headers.get("x-zm-signature");
      return timestamp(time, now) && !!supplied && equal(supplied, `v0=${hmac("sha256", secret, `v0:${time}:${rawBody.toString("utf8")}`, "hex")}`);
    },
    eventId: () => null, eventType: payload => `zoom.${jsonField(payload, "event") || "event"}`,
  },
  FACEBOOK: metaAdapter("FACEBOOK", "Facebook"),
  INSTAGRAM: metaAdapter("INSTAGRAM", "Instagram"),
  WHATSAPP: metaAdapter("WHATSAPP", "WhatsApp"),
  TIKTOK: {
    name: "TIKTOK", displayName: "TikTok", icon: "T", docsUrl: "https://developers.tiktok.com/docs/en/webhooks-verification",
    setupInstructions: ["Configure a webhook callback in your TikTok developer app.", "Paste this ingestion URL and select supported events.", "Copy your TikTok client secret into Hooka Relay.", "Trigger an event in your developer app."], testEventSupport: false,
    verifySignature: ({ rawBody, headers, secret, now }) => {
      const parts = (headers.get("tiktok-signature") || "").split(",").map(part => part.trim());
      const time = parts.find(part => part.startsWith("t="))?.slice(2) || null;
      const supplied = parts.find(part => part.startsWith("s="))?.slice(2);
      return timestamp(time, now) && !!supplied && equal(supplied, hmac("sha256", secret, `${time}.${rawBody.toString("utf8")}`, "hex"));
    },
    eventId: () => null, eventType: payload => `tiktok.${jsonField(payload, "event") || "event"}`,
  },
  LINKEDIN: {
    name: "LINKEDIN", displayName: "LinkedIn", icon: "L", docsUrl: "https://learn.microsoft.com/en-us/linkedin/shared/api-guide/webhook-validation",
    setupInstructions: ["Use a LinkedIn developer application approved for webhooks.", "Register this ingestion URL in its Webhooks settings or the relevant subscription API.", "Enter the application's Client Secret here before LinkedIn validates the URL.", "Trigger a supported event and check the delivery log."], testEventSupport: false,
    verifySignature: ({ rawBody, headers, secret }) => {
      const supplied = headers.get("x-li-signature");
      return !!supplied && equal(supplied, hmac("sha256", secret, Buffer.concat([Buffer.from("hmacsha256="), rawBody]), "hex"));
    },
    eventId: payload => jsonField(payload, "id"), eventType: payload => `linkedin.${jsonField(payload, "type") || "event"}`,
  },
  ZENDESK: {
    name: "ZENDESK", displayName: "Zendesk", icon: "Z", docsUrl: "https://developer.zendesk.com/documentation/webhooks/verifying/",
    setupInstructions: ["Create a webhook in Zendesk Admin Center and paste this ingestion URL.", "Enable signing, then copy the webhook signing secret into Hooka Relay.", "Subscribe to the events you need and trigger a test delivery."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret }) => {
      const signature = headers.get("x-zendesk-webhook-signature");
      const time = headers.get("x-zendesk-webhook-signature-timestamp");
      return !!signature && !!time && equal(signature, hmac("sha256", secret, Buffer.concat([Buffer.from(time), rawBody]), "base64"));
    },
    eventId: payload => jsonField(payload, "id"), eventType: payload => `zendesk.${jsonField(payload, "type") || "event"}`,
  },
  TYPEFORM: {
    name: "TYPEFORM", displayName: "Typeform", icon: "T", docsUrl: "https://www.typeform.com/developers/webhooks/secure-your-webhooks/",
    setupInstructions: ["Create a webhook for your Typeform form and paste this ingestion URL.", "Set a webhook secret in Typeform and enter the same value in Hooka Relay.", "Submit a test response to confirm delivery."], testEventSupport: false,
    verifySignature: ({ rawBody, headers, secret }) => {
      const signature = headers.get("typeform-signature");
      return !!signature && equal(signature, `sha256=${hmac("sha256", secret, rawBody, "base64")}`);
    },
    eventId: payload => jsonField(payload, "event_id"), eventType: payload => `typeform.${jsonField(payload, "event_type") || "event"}`,
  },
  PADDLE: {
    name: "PADDLE", displayName: "Paddle", icon: "P", docsUrl: "https://developer.paddle.com/webhooks/about/signature-verification/",
    setupInstructions: ["Create a URL notification destination in Paddle and paste this ingestion URL.", "Copy that destination's secret key into Hooka Relay.", "Subscribe to the event types you need and send a simulated webhook from Paddle."], testEventSupport: true,
    verifySignature: ({ rawBody, headers, secret, now }) => {
      const parts = (headers.get("paddle-signature") || "").split(";").map(part => part.trim());
      const time = parts.find(part => part.startsWith("ts="))?.slice(3) || null;
      if (!timestamp(time, now)) return false;
      const expected = hmac("sha256", secret, Buffer.concat([Buffer.from(`${time}:`), rawBody]), "hex");
      return parts.some(part => part.startsWith("h1=") && equal(part.slice(3), expected));
    },
    eventId: payload => jsonField(payload, "event_id"), eventType: payload => `paddle.${jsonField(payload, "event_type") || "event"}`,
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
