import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { publicAddress, signature } from "../lib/security";
test("SSRF rejects loopback, private, mapped, link-local and reserved IPs", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
    "224.0.0.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("HMAC signs exact raw JSON bytes", () => {
  const body = '{"hello": "world"}';
  assert.equal(
    signature(body, "secret"),
    "sha256=" + createHmac("sha256", "secret").update(body).digest("hex"),
  );
  assert.notEqual(
    signature(body, "secret"),
    signature('{"hello":"world"}', "secret"),
  );
});
