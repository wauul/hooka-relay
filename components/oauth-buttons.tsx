"use client";
import { signIn } from "next-auth/react";
import { useData } from "./ui";
export function OAuthButtons({ callbackUrl = "/dashboard", linking = false }: { callbackUrl?: string; linking?: boolean }) {
  const { data } = useData<Record<string, unknown>>("/api/auth/providers");
  return <div style={{ display: "grid", gap: 12, margin: "20px 0" }}>{["github", "google"].map(provider => <button key={provider} type="button" className="btn secondary" disabled={!data?.[provider]} onClick={() => signIn(provider, { callbackUrl })}>{linking ? "Link" : "Continue with"} {provider === "github" ? "GitHub" : "Google"}{data && !data[provider] ? " · not configured" : ""}</button>)}</div>;
}
