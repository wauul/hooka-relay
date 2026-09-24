import { forwardableProviderHeaders } from "./inbound-headers";

export function originalReplayPayload(receipt: { rawBody: string; rawHeaders: unknown }) {
  return {
    body: Buffer.from(receipt.rawBody, "base64"),
    headers: forwardableProviderHeaders(receipt.rawHeaders as Record<string, string>),
  };
}
