import type { Metadata } from "next";
import "./globals.css";
import { SiteTools } from "@/components/site-tools";
export const metadata: Metadata = {
  title: "Hooka Relay — Every event. Delivered.",
  description:
    "Reliable webhook delivery with automatic retries, circuit breaking, and complete observability.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SiteTools>{children}</SiteTools>
      </body>
    </html>
  );
}
