import { InviteAuth } from "@/components/invite-auth";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  return <InviteAuth signup={true} token={invite} />;
}
