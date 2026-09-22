"use client";
import { T } from "@/components/preferences";
import { PreferencesMenu } from "@/components/preferences";
import { useState } from "react";
import Link from "next/link";
import { Brand } from "./shell";
import { api, ErrorBox } from "./ui";
type Mode = "verify-email" | "reset-password" | "forgot-password" | "resend-verification";
const titles: Record<Mode, string> = { "verify-email": "Confirm your email", "reset-password": "Choose a new password", "forgot-password": "Forgot your password?", "resend-verification": "Send a confirmation link" };
export function AccountEmailForm({ mode, token }: { mode: Mode; token?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [callback, setCallback] = useState("/dashboard");
  const consume = mode === "verify-email" || mode === "reset-password";
  return <main id="main-content" className="account-page"><header className="public-header"><Brand /><PreferencesMenu /></header><div className="account-card panel panel-body"><h1 style={{ marginTop: 40 }}><T text={titles[mode]} /></h1><p className="muted" style={{ lineHeight: 1.7 }}>{mode === "verify-email" ? "Confirm this address to finish setting up your account. The link is used only when you press the button." : mode === "reset-password" ? "Use at least 12 characters. You will sign in again after resetting your password." : "Enter your email address. If it is eligible, we’ll send you a link."}</p><ErrorBox error={error} />{message ? <div role="status"><p>{message}</p><Link className="btn" href={`/login?callbackUrl=${encodeURIComponent(callback)}`}><T text={"Continue to sign in"} /></Link></div> : <form style={{ marginTop: 24 }} onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); const form = new FormData(e.currentTarget); try { const result = await api<{ message?: string; callbackPath?: string }>(`/api/account/${mode}`, consume ? { token, ...(mode === "reset-password" ? { password: String(form.get("password")) } : {}) } : { email: String(form.get("email")) }); setCallback(result.callbackPath || "/dashboard"); setMessage(result.message || (mode === "verify-email" ? "Your email is confirmed. You can now sign in." : "Your password has been reset. Previous sessions have been signed out.")); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
    {!consume && <div className="field"><label htmlFor="recovery-email"><T text={"Email address"} /></label><input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required /></div>}
    {mode === "reset-password" && <div className="field"><label htmlFor="new-password"><T text={"New password"} /></label><input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></div>}
    {consume && !token ? <p><T text={"This link is missing its token. Request a new email below."} /></p> : <button className="btn" disabled={busy}>{busy ? "One moment…" : consume ? titles[mode] : "Send link"}</button>}
    <p style={{ marginTop: 24 }}><Link className="auth-link" href={mode === "verify-email" ? "/resend-verification" : mode === "reset-password" ? "/forgot-password" : "/login"}><T text={mode === "verify-email" ? "Request a new confirmation link" : mode === "reset-password" ? "Request a new reset link" : "Back to sign in"} /></Link></p>
  </form>}</div></main>;
}
