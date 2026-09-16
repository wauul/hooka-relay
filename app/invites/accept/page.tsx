"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ErrorBox } from "@/components/ui";
export default function Page() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(false);
  useEffect(() => { setToken(new URLSearchParams(window.location.search).get("token") || ""); }, []);
  const callback = encodeURIComponent(`/invites/accept?token=${encodeURIComponent(token)}`);
  return <main className="content"><section className="panel panel-body"><h1>Join a workspace</h1><p>Sign in with the email address that received this invitation, then accept to join the team.</p><ErrorBox error={error} />
    <button className="btn" disabled={busy || !token} onClick={async () => { setBusy(true); setError(""); try { const result = await api<{ workspaceId: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, {}); localStorage.setItem("workspaceId", result.workspaceId); window.location.assign("/dashboard"); } catch (e) { if ((e as Error).message === "UNAUTHORIZED") setLogin(true); else setError((e as Error).message); } finally { setBusy(false); } }}>Accept invitation</button>
    {login && <p>Sign in or create an account to accept this invitation.</p>}
    <p><Link href={`/login?callbackUrl=${callback}`}>Sign in</Link> · <Link href={`/signup?callbackUrl=${callback}`}>Create account</Link></p>
  </section></main>;
}
