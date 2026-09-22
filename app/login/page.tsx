import { InviteAuth } from "@/components/invite-auth";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; error?: string }>;
}) {
  const { invite, error } = await searchParams;
  return <InviteAuth signup={false} token={invite} authError={error} />;
}
