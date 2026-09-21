import { headers } from "next/headers";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { SiteTools } from "@/components/site-tools";
export const metadata: Metadata = {
  title: "Hooka Relay — Every event. Delivered.",
  description:
    "Reliable webhook delivery with automatic retries, circuit breaking, and complete observability.",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Nonce CSP requires per-request rendering, not cached static HTML.
  await headers();
  return (
    <html lang="en">
      <body>
        <SiteTools>{children}</SiteTools>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
