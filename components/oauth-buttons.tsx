"use client";
import { T } from "@/components/preferences";
import { Github } from "lucide-react";
import { GoogleIcon } from "./provider-icons";
import { signIn } from "next-auth/react";
import { useData } from "./ui";
export function OAuthButtons({ callbackUrl = "/dashboard", linking = false, connected = [] }: { callbackUrl?: string; linking?: boolean; connected?: string[] }) {
  const { data } = useData<Record<string, unknown>>("/api/auth/providers");
  return <div className="oauth-buttons">{["github", "google"].map(provider => <button key={provider} type="button" className="btn secondary" disabled={!data?.[provider] || connected.includes(provider)} onClick={() => signIn(provider, { callbackUrl })}>{provider === "github" ? <Github size={18} aria-hidden="true" /> : <GoogleIcon />}<T text={connected.includes(provider) ? "Connected to" : linking ? "Link" : "Continue with"} /> {provider === "github" ? "GitHub" : "Google"}{data && !data[provider] ? " · not configured" : ""}</button>)}</div>;
}
