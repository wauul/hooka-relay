import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
export const newSecret = () => randomBytes(32).toString("hex");
// Sign the exact bytes transmitted, not a reserialized object on the receiver.
export const signature = (raw: string, secret: string) =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolveEndpoint(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Use a public HTTPS URL on port 443 without credentials.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error("Private and reserved addresses are not allowed.");
  return { url, address: addresses[0] };
}
