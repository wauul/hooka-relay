import { sendTransactionalEmail } from "./transactional-email";
export async function sendInvite(invite: { id: string; email: string; token: string; workspace: { name: string }; expiresAt: Date }) {
  if (!process.env.NEXTAUTH_URL) throw new Error("Email configuration missing");
  const link = new URL("/invites/accept", process.env.NEXTAUTH_URL);
  link.searchParams.set("token", invite.token);
  await sendTransactionalEmail({ id: `workspace-invite-${invite.id}`, to: invite.email, subject: "Invitation to a Hooka Relay workspace", title: `Join ${invite.workspace.name}`, body: `You have been invited to ${invite.workspace.name}. Sign in or create an account with ${invite.email}, then choose whether to join.`, action: "Review invitation", url: link.toString(), footer: `Expires ${invite.expiresAt.toISOString()}. If you were not expecting this invitation, ignore this email.` });
}
