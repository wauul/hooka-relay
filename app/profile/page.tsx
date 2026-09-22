"use client";
import { useState } from "react";
import { UserRound, Check } from "lucide-react";
import { OAuthButtons } from "@/components/oauth-buttons";
import { Shell } from "@/components/shell";
import { api, ErrorBox, useData } from "@/components/ui";
export default function Page() {
  const { data, error, reload } = useData<{
    displayName: string;
    email: string;
  }>("/api/profile");
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <div className="page-head">
        <div>
          <div className="eyebrow">YOUR ACCOUNT</div>
          <p className="muted">
            Choose how your teammates see you across your workspaces.
          </p>
        </div>
      </div>
      <section className="panel panel-body profile-panel">
        <div className="invite-icon">
          <UserRound size={26} />
        </div>
        <ErrorBox error={error || failure} />
        {data && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const displayName = String(
                new FormData(e.currentTarget).get("displayName"),
              );
              setBusy(true);
              setFailure("");
              setSaved(false);
              try {
                await api("/api/profile", { displayName }, "PATCH");
                await reload();
                setSaved(true);
                window.dispatchEvent(new Event("profile-updated"));
              } catch (e) {
                setFailure((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="field">
              <label htmlFor="display-name">Display name</label>
              <input
                id="display-name"
                name="displayName"
                defaultValue={data.displayName}
                minLength={1}
                maxLength={40}
                required
                autoComplete="nickname"
                onChange={() => setSaved(false)}
              />
              <small className="muted">
                1-40 characters. This is a display name, so it does not need to
                be unique.
              </small>
            </div>
            <div className="field">
              <div className="profile-email-label">Email address</div>
              <p className="profile-email">{data.email}</p>
              <small className="muted">
                Used for sign-in and workspace invitations.
              </small>
            </div>
            <button className="btn" disabled={busy}>
              {busy ? "Saving..." : "Save changes"}
            </button>
            <span role="status" className="profile-saved">
              {saved && (
                <>
                  <Check size={15} /> Display name saved
                </>
              )}
            </span>
          </form>
        )}
      </section>
      <section className="panel panel-body profile-panel" style={{ marginTop: 24 }}><h2>Connected sign-in methods</h2><p className="muted">Link your GitHub or Google account while signed in. Use your existing sign-in method first if a provider says your email is already registered.</p><OAuthButtons callbackUrl="/profile" linking /></section>
    </Shell>
  );
}
