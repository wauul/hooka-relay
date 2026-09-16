"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { SearchButton } from "./site-tools";
import { Brand } from "./shell";
import { api, ErrorBox } from "./ui";
export function AuthForm({
  signup = false,
  invitation,
}: {
  signup?: boolean;
  invitation?: { token: string; email: string; workspaceName: string };
}) {
  const [error, setError] = useState("");
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
              if (signup)
                await api("/api/signup", {
                  email,
                  password,
                  inviteToken: invitation?.token,
                });
              const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
              });
              if (result?.error)
                throw new Error("Email or password is incorrect.");
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
            <Brand />
            {!invitation && <SearchButton />}
          </div>
          <div className="eyebrow">
            {invitation ? "STEP 1 OF 2 · YOUR ACCOUNT" : "HOOKA RELAY"}
          </div>
          <h2>
            {invitation
              ? signup
                ? "Create your account."
                : "Sign in to continue."
              : signup
                ? "Start delivering."
                : "Welcome back."}
          </h2>
          <p className="muted" style={{ marginBottom: 28 }}>
            {invitation
              ? `You’re invited to ${invitation.workspaceName}. ${signup ? "Create an account" : "Sign in"} to review your invitation.`
              : signup
                ? "Create your account and put your events in motion."
                : "Sign in to your webhook workspace."}
          </p>
          <ErrorBox error={error} />
          <div className="field">
            <label htmlFor="email">Email address</label>
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
            <label htmlFor="password">Password</label>
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
            {busy ? "One moment…" : signup ? "Create account" : "Sign in"}
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <ArrowRight size={15} />
            )}
          </button>
          {!invitation && (
            <p
              className="muted"
              style={{ textAlign: "center", marginTop: 24, fontSize: 12 }}
            >
              {signup ? "Already have an account?" : "New to Hooka Relay?"}{" "}
              <Link
                className="auth-link"
                href={
                  (signup ? "/login" : "/signup") +
                  (typeof window === "undefined" ? "" : window.location.search)
                }
              >
                {signup ? "Sign in" : "Create an account"}
              </Link>
            </p>
          )}
          {invitation && (
            <p className="invite-next-note">
              You’ll choose whether to accept or decline after{" "}
              {signup ? "creating your account" : "signing in"}.
            </p>
          )}
          <p className="muted" style={{ textAlign: "center", fontSize: 11 }}>
            <Link href="/docs">Read the documentation ↗</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
