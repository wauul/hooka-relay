import { NextRequest, NextResponse } from "next/server";
import { SITE_ORIGIN } from "./lib/site-url";
export function proxy(request: NextRequest) {
  // Move public navigation to the canonical domain. Keep the old API host
  // serving requests so existing clients do not lose auth across redirects.
  if (request.nextUrl.hostname === "hooka-relay.vercel.app" &&
      ["GET", "HEAD"].includes(request.method) &&
      ["/", "/docs", "/privacy", "/terms", "/login", "/signup", "/robots.txt", "/sitemap.xml"].includes(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, SITE_ORIGIN), 308);
  }
  const nonce = btoa(crypto.randomUUID());
  const development = process.env.NODE_ENV !== "production";
  // Fresh nonces prevent injected scripts from running; frame-ancestors blocks
  // clickjacking and base-uri prevents injected <base> URL hijacking.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' https://vitals.vercel-insights.com${development ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const headers = new Headers(request.headers);
  const privatePage = request.nextUrl.pathname.startsWith("/portal/") || request.nextUrl.pathname.startsWith("/invites/") || ["/verify-email", "/reset-password"].includes(request.nextUrl.pathname);
  headers.set("x-hooka-private-page", privatePage ? "1" : "0");
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", privatePage ? "no-referrer" : "same-origin");
  // Only stable public content pages are intended for search indexing.
  const indexablePages = new Set(["/", "/docs", "/privacy", "/terms", "/robots.txt", "/sitemap.xml", "/opengraph-image"]);
  if (!indexablePages.has(request.nextUrl.pathname))
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!development)
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
