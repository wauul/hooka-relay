import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
export const newSecret = () => randomBytes(32).toString("hex");
// Bind the signing time to the exact transmitted bytes. A body-only HMAC lets
// anyone replay a captured valid request indefinitely.
export function signature(raw: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}
// Receivers must also deduplicate the idempotency key: the clock window limits
// replay age, but cannot prevent duplicates within the five-minute window.
export function verifySignature(
  raw: string,
  supplied: string | null | undefined,
  secret: string,
  now = Date.now(),
) {
  const parts = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(supplied || "");
  if (!parts) return false;
  const timestamp = Number(parts[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${parts[1]}.${raw}`).digest();
  return timingSafeEqual(Buffer.from(parts[2], "hex"), expected);
}
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function validateOutboundUrl(input: string) {
  if (input.length > 2048)
    throw new Error("Endpoint URL exceeds 2048 characters.");
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Use a public HTTPS URL on port 443 without credentials.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  // Reject internal names before DNS: split-horizon/search-domain resolution
  // must never turn an attacker-controlled endpoint into an internal request.
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    /\.(local|internal|lan|home|test|invalid|onion)$/.test(normalized) ||
    normalized === "metadata.google.internal" ||
    (!normalized.includes(".") && !ipaddr.isValid(normalized))
  )
    throw new Error("Internal hostnames are not allowed.");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Private and reserved addresses are not allowed.");
  return { url, address: addresses[0] };
}
// Keep existing registration and delivery call sites on the same validator.
export const resolveEndpoint = validateOutboundUrl;
