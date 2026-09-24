import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Landing } from "@/components/landing";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Webhook Delivery Service for SaaS Teams | Hooka Relay",
  description: "Send signed webhooks with retries, delivery logs, failure investigation and replay. Hooka Relay helps SaaS teams manage outbound webhook delivery.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Hooka Relay",
    title: "Webhook Delivery Service for SaaS Teams | Hooka Relay",
    description: "Signed webhooks, retries, delivery logs and replay for SaaS teams.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Hooka Relay webhook delivery for SaaS teams" }],
  },
  twitter: { card: "summary_large_image", title: "Webhook Delivery Service for SaaS Teams | Hooka Relay", description: "Signed webhooks, retries, delivery logs and replay for SaaS teams.", images: ["/opengraph-image"] },
};
export default async function Page() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { id?: string } | undefined)?.id) redirect("/dashboard");
  return <Landing />;
}
