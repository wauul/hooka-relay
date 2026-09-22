import Link from "next/link";
import { redirect } from "next/navigation";
import { invitationDetails, WorkspaceError } from "@/lib/workspaces";
import { AuthForm } from "./auth-form";
import { InviteLayout } from "./invite-layout";
export async function InviteAuth({
  signup,
  token,
  authError,
}: {
  signup: boolean;
  token?: string;
  authError?: string;
}) {
  if (!token) return <AuthForm authError={authError} signup={signup} />;
  let invite;
  try {
    invite = await invitationDetails(token);
  } catch (e) {
    if (!(e instanceof WorkspaceError)) throw e;
    return (
      <InviteLayout>
        <h1>Invitation unavailable</h1>
        <p>{e.message}</p>
        <Link className="btn" href="/login">
          Sign in
        </Link>
      </InviteLayout>
    );
  }
  if (signup === invite.accountExists)
    redirect(
      `/${invite.accountExists ? "login" : "signup"}?invite=${encodeURIComponent(token)}`,
    );
  return <AuthForm authError={authError} signup={signup} invitation={{ token, ...invite }} />;
}
