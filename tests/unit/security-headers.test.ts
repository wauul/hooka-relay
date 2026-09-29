import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
it("moves public navigation while preserving existing API clients and preview hosts", () => {
  const r = proxy(new NextRequest("https://hooka-relay.vercel.app/docs?section=signatures"));
  expect(r.status).toBe(308);
  expect(r.headers.get("location")).toBe("https://hooka-relay.com/docs?section=signatures");
  for (const url of ["https://hooka-relay.vercel.app/api/v1/events", "https://preview.example.com/docs", "https://hooka-relay.com/docs"])
    expect(proxy(new NextRequest(url)).headers.get("location")).toBeNull();
});
it("adds independent CSP nonces and hardening headers in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    const a = proxy(new NextRequest("https://example.com/login"));
    const b = proxy(new NextRequest("https://example.com/login"));
    expect(a.headers.get("Content-Security-Policy")).not.toBe(
      b.headers.get("Content-Security-Policy"),
    );
    expect(a.headers.get("Content-Security-Policy")).toContain(
      "'strict-dynamic'",
    );
    expect(a.headers.get("Content-Security-Policy")).not.toContain(
      "'unsafe-eval'",
    );
    expect(a.headers.get("X-Frame-Options")).toBe("DENY");
    expect(a.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(a.headers.get("Strict-Transport-Security")).toContain("31536000");
    expect(a.headers.get("Referrer-Policy")).toBe("same-origin");
  } finally {
    vi.unstubAllEnvs();
  }
});

it("keeps capability links out of referrers and marks them for analytics exclusion", () => {
  const r = proxy(new NextRequest("https://example.com/portal/private-token", { headers: { "x-hooka-private-page": "0" } }));
  expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(r.headers.get("x-middleware-request-x-hooka-private-page")).toBe("1");
  expect(r.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
});

it("indexes only intended public content pages", () => {
  for (const path of ["/", "/docs", "/privacy", "/terms", "/robots.txt", "/sitemap.xml", "/opengraph-image"])
    expect(proxy(new NextRequest(`https://example.com${path}`)).headers.get("X-Robots-Tag")).toBeNull();
  for (const path of ["/status", "/dashboard", "/signup", "/login", "/forgot-password", "/reset-password?token=secret", "/invites/accept?token=secret", "/portal/private-token", "/api/search"])
    expect(proxy(new NextRequest(`https://example.com${path}`)).headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
});
