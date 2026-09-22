"use client";
import { T } from "@/components/preferences";
import { PreferencesMenu } from "@/components/preferences";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Brand } from "./shell";
import { OAuthButtons } from "./oauth-buttons";
import { api, ErrorBox } from "./ui";
export function AuthForm({
  signup = false,
  invitation,
  authError,
}: {
  signup?: boolean;
  authError?: string;
  invitation?: { token: string; email: string; workspaceName: string };
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState(authError === "OAuthAccountNotLinked" ? "An account already uses this email. Sign in with your existing method, then link the provider from Your profile." : authError ? "Sign-in could not be completed. Check that your provider email is verified and try again." : "");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const router = useRouter();
  return (
    <div className="auth-page">
      <section className="auth-art">
        <Brand />
        <div>
          <div className="eyebrow">THE LAST MILE, HANDLED.</div>
          <h1>
            Every event.
            <br />
            <span style={{ color: "var(--green)" }}>Delivered.</span>
          </h1>
          <p>
            Your webhooks deserve a reliable route. Send once. We’ll handle the
            retries, recovery, and everything in between.
          </p>
          <div className="flow-art">
            <div className="flow-node">your app</div>
            <ArrowRight size={20} />
            <div className="flow-node">hooka relay</div>
            <ArrowRight size={20} />
            <CheckCircle2 size={26} />
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          Built for developers. Designed for the unexpected.
        </div>
      </section>
      <main className="auth-form" id="main-content" tabIndex={-1}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            const email = invitation?.email || String(f.get("email"));
            const password = String(f.get("password"));
            try {
              if (signup) {
                await api("/api/signup", {
                  email,
                  password,
                  inviteToken: invitation?.token,
                });
                setMessage("Check your inbox to confirm your email before signing in. You can resend the link below.");
                return;
              }
              const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
              });
              if (result?.error)
                throw new Error(result.error === "EMAIL_UNVERIFIED" ? "Please confirm your email before signing in. Use Resend confirmation below if needed." : "Email or password is incorrect.");
              const callback = new URLSearchParams(window.location.search).get(
                "callbackUrl",
              );
              router.push(
                invitation
                  ? `/invites/accept?token=${encodeURIComponent(invitation.token)}`
                  : callback?.startsWith("/invites/accept?")
                    ? callback
                    : "/dashboard",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="auth-utilities">
            <Brand /><PreferencesMenu />
          </div>
          <div className="eyebrow">
            {invitation ? "STEP 1 OF 2 · YOUR ACCOUNT" : "HOOKA RELAY"}
          </div>
          <h2>
            <T text={invitation
              ? signup
                ? "Create your account."
                : "Sign in to continue."
              : signup
                ? "Start delivering."
                : "Welcome back."} />
          </h2>
          <p className="muted" style={{ marginBottom: 28 }}>
            {invitation
              ? `You’re invited to ${invitation.workspaceName}. ${signup ? "Create an account" : "Sign in"} to review your invitation.`
              : signup
                ? <T text="Create your account and put your events in motion." />
                : <T text="Sign in to your webhook workspace." />}
          </p>
          {signup && <p className="muted auth-help"><T text={"Email signups require confirmation before you can sign in."} /></p>}
          <ErrorBox error={error} />
          {message && <p role="status" style={{ marginBottom: 20 }}>{message}</p>}
          <OAuthButtons callbackUrl={invitation ? `/invites/accept?token=${encodeURIComponent(invitation.token)}` : "/dashboard"} />
          <p className="muted" style={{ textAlign: "center", marginBottom: 20 }}><T text={"Or use your email and password"} /></p>
          <div className="field">
            <label htmlFor="email"><T text={"Email address"} /></label>
            <input
              defaultValue={invitation?.email}
              readOnly={!!invitation}
              aria-describedby={invitation ? "invite-email-note" : undefined}
              id="email"
              name="email"
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>
          {invitation && (
            <p id="invite-email-note" className="invite-email-note">
              This invitation is linked to this email address.
            </p>
          )}
          <div className="field">
            <label htmlFor="password"><T text={"Password"} /></label>
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={visible ? "text" : "password"}
                minLength={signup ? 12 : 1}
                maxLength={72}
                placeholder={
                  signup ? "At least 12 characters" : "Your password"
                }
                autoComplete={signup ? "new-password" : "current-password"}
                required
              />
              <button
                className="icon-button"
                type="button"
                aria-label={visible ? "Hide password" : "Show password"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button disabled={busy} className="btn">
            <T text={busy ? "One moment…" : signup ? "Create account" : "Sign in"} />
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <ArrowRight size={15} />
            )}
          </button>
          <p style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 20, fontSize: 12 }}>{!signup && <Link className="auth-link" href="/forgot-password"><T text={"Forgot password?"} /></Link>}<Link className="auth-link" href="/resend-verification"><T text={"Resend confirmation"} /></Link></p>
          {!invitation && (
            <p
              className="muted"
              style={{ textAlign: "center", marginTop: 24, fontSize: 12 }}
            >
              <T text={signup ? "Already have an account?" : "New to Hooka Relay?"} />{" "}
              <Link
                className="auth-link"
                href={
                  (signup ? "/login" : "/signup") +
                  (typeof window === "undefined" ? "" : window.location.search)
                }
              >
                <T text={signup ? "Sign in" : "Create an account"} />
              </Link>
            </p>
          )}
          {invitation && (
            <p className="invite-next-note">
              You’ll choose whether to accept or decline after{" "}
              {signup ? "creating your account" : "signing in"}.
            </p>
          )}
          <p className="legal-links"><Link href="/terms"><T text={"Terms of Use"} /></Link><Link href="/privacy"><T text={"Privacy"} /></Link></p>
          <p className="muted" style={{ textAlign: "center", fontSize: 11 }}>
            <Link href="/docs"><T text={"Read the documentation ↗"} /></Link>
          </p>
        </form>
      </main>
    </div>
  );
}
