"use client";
import { T } from "@/components/preferences";
import { GithubIcon, GoogleIcon, MicrosoftIcon } from "./provider-icons";
import { signIn } from "next-auth/react";
import { useData } from "./ui";
const providers = [
  { id: "github", name: "GitHub", icon: GithubIcon },
  { id: "google", name: "Google", icon: GoogleIcon },
  { id: "azure-ad", name: "Microsoft", icon: MicrosoftIcon },
];
export function OAuthButtons({ callbackUrl = "/dashboard", linking = false, connected = [] }: { callbackUrl?: string; linking?: boolean; connected?: string[] }) {
  const { data } = useData<Record<string, unknown>>("/api/auth/providers");
  return <div className="oauth-buttons">{providers.map(({ id, name, icon: Icon }) => <button key={id} type="button" className="btn secondary" disabled={!data?.[id] || connected.includes(id)} onClick={() => signIn(id, { callbackUrl })}><Icon /><T text={connected.includes(id) ? "Connected to" : linking ? "Link" : "Continue with"} /> {name}{data && !data[id] ? " · not configured" : ""}</button>)}</div>;
}
