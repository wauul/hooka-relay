import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manualVerifierSchema, providers } from "@/lib/webhook-providers";
const request = (body: string, entries: Record<string, string>, secret: string, url = "https://example.com/api/inbound/test", now?: number) => ({ rawBody: Buffer.from(body), headers: new Headers(entries), secret, url, now });

describe("verified provider signatures", () => {
  it("matches GitHub's published SHA-256 vector and rejects tampering", () => {
    // https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
    const secret = "It's a Secret to Everybody", signature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    expect(providers.GITHUB.verifySignature(request("Hello, World!", { "x-hub-signature-256": signature }, secret))).toBe(true);
    expect(providers.GITHUB.verifySignature(request("Hello, World?", { "x-hub-signature-256": signature }, secret))).toBe(false);
    expect(providers.GITHUB.verifySignature(request("Hello, World!", {}, secret))).toBe(false);
  });
  it("matches Slack's published request, signature and timestamp", () => {
    // https://docs.slack.dev/authentication/verifying-requests-from-slack/
    const body = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    const headers = { "x-slack-request-timestamp": "1531420618", "x-slack-signature": "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503" };
    const now = 1531420618 * 1000;
    expect(providers.SLACK.verifySignature(request(body, headers, "8f742231b10e8888abcd99yyyzzz85a5", undefined, now))).toBe(true);
    expect(providers.SLACK.verifySignature(request(body, headers, "8f742231b10e8888abcd99yyyzzz85a5", undefined, now + 301000))).toBe(false);
    expect(providers.SLACK.verifySignature(request(body + "x", headers, "8f742231b10e8888abcd99yyyzzz85a5", undefined, now))).toBe(false);
  });
  it("matches Twilio's published form parameters and signature", () => {
    // https://www.twilio.com/docs/usage/security
    const body = "Digits=1234&To=%2B18005551212&From=%2B14158675310&Caller=%2B14158675310&CallSid=CA1234567890ABCDE";
    const url = "https://example.com/myapp.php?foo=1&bar=2";
    const headers = { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "L/OH5YylLD5NRKLltdqwSvS0BnU=" };
    expect(providers.TWILIO.verifySignature(request(body, headers, "12345", url))).toBe(true);
    expect(providers.TWILIO.verifySignature(request(body, headers, "12345", url + "x"))).toBe(false);
  });
  it("checks Twilio JSON bodySHA256 and the signature over the complete URL", () => {
    // https://www.twilio.com/docs/usage/webhooks/webhooks-security
    const body = '{"CallSid":"CA1234567890ABCDE","Caller":"+12349013030"}';
    const url = `https://example.com/myapp?bodySHA256=${createHash("sha256").update(body).digest("hex")}`;
    const signature = createHmac("sha1", "12345").update(url).digest("base64");
    const headers = { "content-type": "application/json", "x-twilio-signature": signature };
    expect(providers.TWILIO.verifySignature(request(body, headers, "12345", url))).toBe(true);
    expect(providers.TWILIO.verifySignature(request(body + " ", headers, "12345", url))).toBe(false);
    expect(providers.TWILIO.verifySignature(request(body, headers, "12345", url + "&x=1"))).toBe(false);
  });
  it("checks Stripe timestamp and each v1 signature over exact bytes", () => {
    // Stripe documents t=...,v1=... and a 300-second tolerance, but no fixed vector.
    // https://docs.stripe.com/webhooks/signature
    const body = '{"id":"evt_1","type":"charge.succeeded"}', secret = "whsec_test", time = 1700000000;
    const digest = createHmac("sha256", secret).update(`${time}.${body}`).digest("hex");
    const headers = { "stripe-signature": `t=${time},v1=bad,v1=${digest}` };
    expect(providers.STRIPE.verifySignature(request(body, headers, secret, undefined, time * 1000))).toBe(true);
    expect(providers.STRIPE.verifySignature(request(body, headers, secret, undefined, (time + 301) * 1000))).toBe(false);
    expect(providers.STRIPE.verifySignature(request(body + " ", headers, secret, undefined, time * 1000))).toBe(false);
  });
  it("checks Shopify's base64 raw-body HMAC", () => {
    // https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
    const body = '{"id":123}', secret = "shopify-app-secret";
    const signature = createHmac("sha256", secret).update(body).digest("base64");
    expect(providers.SHOPIFY.verifySignature(request(body, { "x-shopify-hmac-sha256": signature }, secret))).toBe(true);
    expect(providers.SHOPIFY.verifySignature(request(body + " ", { "x-shopify-hmac-sha256": signature }, secret))).toBe(false);
  });
  it("checks WooCommerce's documented base64 raw-body HMAC", () => {
    // https://developer.woocommerce.com/docs/apis/rest-api/v2/webhooks
    const body = '{"order":{"id":118}}', secret = "woocommerce-secret";
    const signature = createHmac("sha256", secret).update(body).digest("base64");
    expect(providers.WOOCOMMERCE.verifySignature(request(body, { "x-wc-webhook-signature": signature }, secret))).toBe(true);
    expect(providers.WOOCOMMERCE.verifySignature(request(body + " ", { "x-wc-webhook-signature": signature }, secret))).toBe(false);
  });
  it("supports manual hex/body and base64/timestamp formats", () => {
    const body = '{"ok":true}', secret = "custom-key";
    const hex = createHmac("sha256", secret).update(body).digest("hex");
    const plain = manualVerifierSchema.parse({ signatureHeader: "X-Signature", algorithm: "sha256", encoding: "hex", signedPayload: "body", signaturePrefix: "sha256=" });
    expect(providers.CUSTOM.verifySignature({ ...request(body, { "x-signature": `sha256=${hex}` }, secret), manualConfig: plain })).toBe(true);
    const now = 1700000000000, time = String(now / 1000);
    const base64 = createHmac("sha1", secret).update(`${time}.${body}`).digest("base64");
    const timed = manualVerifierSchema.parse({ signatureHeader: "X-Signature", algorithm: "sha1", encoding: "base64", signedPayload: "timestamp-body", timestampHeader: "X-Time", timestampFormat: "{timestamp}.{body}" });
    expect(providers.CUSTOM.verifySignature({ ...request(body, { "x-signature": base64, "x-time": time }, secret, undefined, now), manualConfig: timed })).toBe(true);
    expect(providers.CUSTOM.verifySignature({ ...request(body, { "x-signature": base64, "x-time": time }, secret, undefined, now + 301000), manualConfig: timed })).toBe(false);
  });
});
