import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "standardwebhooks";
import { HookaRelay, HookaError, verifyWebhook } from "../dist/index.js";
const event = { id: "evt_1", applicationId: "app_1", type: "order.created", payload: { id: 1 }, idempotencyKey: "order-1", operational: false, createdAt: new Date().toISOString() };
test("sends exact payload/key once, returns actual 202 event", async () => {
  let calls = 0;
  const client = new HookaRelay("test-key", { fetch: async (url, init) => {
    calls++;
    assert.equal(url, "https://hooka-relay.vercel.app/api/v1/events");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), { type: event.type, payload: event.payload, idempotencyKey: "order-1" });
    return Response.json(event, { status: 202 });
  } });
  assert.deepEqual(await client.sendEvent({ type: event.type, payload: event.payload, idempotencyKey: "order-1" }), event);
  assert.equal(calls, 1);
});
test("exposes quota and schema failures without retrying or leaking key", async () => {
  for (const status of [400, 401, 403, 413, 429, 503]) {
    let calls = 0;
    const client = new HookaRelay("secret-test-key", { fetch: async () => { calls++; return Response.json({ error: "test", failures: [{ path: "/id", message: "required" }] }, { status, headers: { "Retry-After": "12" } }); } });
    await assert.rejects(client.sendEvent({ type: "test", payload: null }), e => e instanceof HookaError && e.status === status && e.retryAfter === "12" && e.body.failures[0].path === "/id" && !e.message.includes("secret-test-key"));
    assert.equal(calls, 1);
  }
});
test("rejects insecure remote origin and invalid response", async () => {
  assert.throws(() => new HookaRelay("key", { baseUrl: "http://example.com" }));
  assert.throws(() => new HookaRelay("key", { baseUrl: "https://user:pass@example.com" }));
  await assert.rejects(new HookaRelay("key", { fetch: async () => Response.json({}, { status: 202 }) }).sendEvent({ type: "test", payload: null }), /Invalid.*response/);
});
test("reference verification accepts both rotation keys and rejects tampered ID/body and old timestamp", () => {
  const keys = ["whsec_" + Buffer.alloc(32, 1).toString("base64"), "whsec_" + Buffer.alloc(32, 2).toString("base64")];
  const raw = '{"hello":"world"}', id = "evt_stable", now = new Date();
  const headers = { "webhook-id": id, "webhook-timestamp": String(Math.floor(now.getTime() / 1000)), "webhook-signature": keys.map(key => new Webhook(key).sign(id, now, raw)).join(" ") };
  for (const key of keys) assert.deepEqual(verifyWebhook(raw, headers, key), { hello: "world" });
  assert.throws(() => verifyWebhook(raw, { ...headers, "webhook-id": "forged" }, keys[0]));
  assert.throws(() => verifyWebhook(raw + " ", headers, keys[0]));
  const old = new Date(Date.now() - 600_000);
  assert.throws(() => verifyWebhook(raw, { ...headers, "webhook-timestamp": String(Math.floor(old.getTime() / 1000)), "webhook-signature": new Webhook(keys[0]).sign(id, old, raw) }, keys[0]));
});
