import { AccountEmailForm } from "@/components/account-email-form";
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token } = await searchParams; return <AccountEmailForm mode="reset-password" token={token} />; }
