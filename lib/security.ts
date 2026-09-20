import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
export const newSecret = () => randomBytes(32).toString("hex");
// Sign the exact bytes transmitted, not a reserialized object on the receiver.
export const signature = (raw: string, secret: string) =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
// Receivers must verify the original bytes before parsing JSON. Check the
// length first: timingSafeEqual throws for malformed, unequal-length inputs.
export function verifySignature(
  raw: string,
  supplied: string | null | undefined,
  secret: string,
) {
  const expected = Buffer.from(signature(raw, secret));
  const actual = Buffer.from(supplied || "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
