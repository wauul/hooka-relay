"use client";
import { T } from "@/components/preferences";
import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ArrowRight, Check, Mail, ShieldCheck } from "lucide-react";
import { api, ErrorBox } from "./ui";
export function InviteDecision({
  token,
  email,
  workspaceName,
  role,
  expiresAt,
  wrongAccount,
}: {
  token: string;
  email: string;
  workspaceName: string;
  role: string;
  expiresAt: string;
  wrongAccount: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [declined, setDeclined] = useState(false);
  async function respond(action: "accept" | "decline") {
    setBusy(action);
    setError("");
    try {
      const result = await api<{ workspaceId?: string }>(
        `/api/invites/${encodeURIComponent(token)}/${action}`,
        {},
      );
      if (action === "decline") setDeclined(true);
      else {
        localStorage.setItem("workspaceId", result.workspaceId!);
        window.location.assign("/dashboard");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (declined)
    return (
      <>
        <div className="eyebrow">INVITATION DECLINED</div>
        <h1>You’re all set.</h1>
        <p>
          You haven’t joined {workspaceName}. If you change your mind, ask an
          admin for a new invitation.
        </p>
        <Link className="btn" href="/dashboard"><T text={"Go to dashboard"} /><ArrowRight size={16} />
        </Link>
      </>
    );
  return (
    <>
      <div className="invite-steps">
        <span>
          <Check size={14} /> Account
        </span>
        <span className="current">2 · Invitation</span>
      </div>
      <h1>
        You’re invited to
        <br />
        <span>{workspaceName}</span>
      </h1>
      <p>
        A shared space for your team’s applications, endpoints, and deliveries.
      </p>
      <div className="invite-details">
        <div>
          <Mail size={18} />
          <div>
            <small>INVITED EMAIL</small>
            <strong>{email}</strong>
          </div>
        </div>
        <div>
          <ShieldCheck size={18} />
          <div>
            <small>YOUR ROLE</small>
            <strong><T text={role === "ADMIN" ? "Admin" : "Member"} /></strong>
          </div>
        </div>
      </div>
      <p className="invite-permissions">
        {role === "ADMIN"
          ? "Manage applications, endpoints, API keys, and team invitations."
          : "View applications and delivery logs, send test events, and replay deliveries."}
      </p>
      <ErrorBox error={error} />
      {wrongAccount ? (
        <>
          <p>
            This invitation is for a different email. Sign in with the address
            above to continue.
          </p>
          <button
            className="btn"
            onClick={() =>
              signOut({
                callbackUrl: `/invites/accept?token=${encodeURIComponent(token)}`,
              })
            }
          >
            Switch account <ArrowRight size={16} />
          </button>
        </>
      ) : (
        <>
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => respond("accept")}
          >
            <T text={busy === "accept" ? "Joining workspace…" : "Accept invitation"} />
            <ArrowRight size={16} />
          </button>
          <button
            className="invite-decline"
            disabled={!!busy}
            onClick={() => respond("decline")}
          >
            <T text={busy === "decline" ? "Declining…" : "Decline invitation"} />
          </button>
          <small className="invite-expiry">
            Expires{" "}
            {new Date(expiresAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}
            . Joining is your choice.
          </small>
        </>
      )}
    </>
  );
}
