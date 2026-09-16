export async function sendInvite(invite: { id: string; email: string; token: string; workspace: { name: string }; expiresAt: Date }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM || !process.env.NEXTAUTH_URL) throw new Error("Email configuration missing");
  const link = new URL("/invites/accept", process.env.NEXTAUTH_URL);
  link.searchParams.set("token", invite.token);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `workspace-invite-${invite.id}` },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: [invite.email], subject: "Invitation to a Hooka Relay workspace", text: `You have been invited to ${invite.workspace.name}.\n\nSign in or create an account with ${invite.email}, then accept:\n${link}\n\nExpires ${invite.expiresAt.toISOString()}. If you were not expecting this, ignore this email.` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Email send failed");
}
