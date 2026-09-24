const transportHeaders = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "expect", "forwarded", "x-real-ip", "x-nonce", "x-matched-path", "x-invocation-id", "x-hooka-private-page", "content-security-policy", "referrer-policy", "strict-transport-security", "x-frame-options", "x-content-type-options"]);

export function forwardableProviderHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => {
    const lower = name.toLowerCase();
    return !transportHeaders.has(lower) && !lower.startsWith("x-forwarded-") && !lower.startsWith("x-vercel-");
  }));
}
