import { T } from "@/components/preferences";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { invitationDetails, WorkspaceError } from "@/lib/workspaces";
import { InviteLayout } from "@/components/invite-layout";
import { InviteDecision } from "@/components/invite-decision";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  let invite;
  try {
    invite = await invitationDetails(token);
  } catch (e) {
    if (!(e instanceof WorkspaceError)) throw e;
    return (
      <InviteLayout>
        <div className="eyebrow">INVITATION UNAVAILABLE</div>
        <h1><T text={"This link can’t be used."} /></h1>
        <p>{e.message}</p>
        <Link className="btn" href="/dashboard"><T text={"Go to dashboard"} /></Link>
      </InviteLayout>
    );
  }
  const session = await getServerSession(authOptions);
  if (!session?.user)
    redirect(
      `/${invite.accountExists ? "login" : "signup"}?invite=${encodeURIComponent(token)}`,
    );
  return (
    <InviteLayout>
      <InviteDecision
        token={token}
        {...invite}
        wrongAccount={
          session.user.email?.toLowerCase() !== invite.email.toLowerCase()
        }
      />
    </InviteLayout>
  );
}
