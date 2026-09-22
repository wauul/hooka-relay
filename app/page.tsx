import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Landing } from "@/components/landing";
export default async function Page() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { id?: string } | undefined)?.id) redirect("/dashboard");
  return <Landing />;
}
