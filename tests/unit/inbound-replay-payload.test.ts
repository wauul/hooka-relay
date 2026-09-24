import { expect, it } from "vitest";
import { originalReplayPayload } from "../../lib/inbound-replay-payload";

it("replays saved provider bytes without serializing JSON or changing the signature header", () => {
  const original = Buffer.from('{ "value":1, "label":"é" }\n', "utf8");
  const payload = originalReplayPayload({ rawBody: original.toString("base64"), rawHeaders: { "content-type": "application/json", "stripe-signature": "t=1,v1=abc", host: "stripe.example", "content-length": "888", "x-vercel-oidc-token": "sensitive", "x-vercel-sc-headers": "sensitive", "x-invocation-id": "internal" } });
  expect(payload.body).toEqual(original);
  expect(payload.headers["stripe-signature"]).toBe("t=1,v1=abc");
  expect(payload.headers.host).toBeUndefined();
  expect(payload.headers["content-length"]).toBeUndefined();
  expect(payload.headers["x-vercel-oidc-token"]).toBeUndefined();
  expect(payload.headers["x-vercel-sc-headers"]).toBeUndefined();
  expect(payload.headers["x-invocation-id"]).toBeUndefined();
});
