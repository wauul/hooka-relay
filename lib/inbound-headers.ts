const transportHeaders = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "expect"]);

export function forwardableProviderHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => {
    const lower = name.toLowerCase();
    return !transportHeaders.has(lower) && !lower.startsWith("x-forwarded-");
  }));
}
