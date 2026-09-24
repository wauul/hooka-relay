import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { PreferencesProvider } from "@/components/preferences";
import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import { Telemetry } from "@/components/telemetry";
import "./globals.css";
import "./inbound.css";
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
  const privatePage = (await headers()).get("x-hooka-private-page") === "1";
  const session = await getServerSession(authOptions);
  const preferences = await cookies();
  const language = preferences.get("hooka-language")?.value === "fr" ? "fr" : "en";
  const theme = preferences.get("hooka-theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang={language} data-theme={theme} data-scroll-behavior="smooth">
      <body>
        <PreferencesProvider initialLanguage={language} initialTheme={theme}><SiteTools signedIn={!!(session?.user as { id?: string } | undefined)?.id}>{children}</SiteTools></PreferencesProvider>
        {!privatePage && <Telemetry />}
      </body>
    </html>
  );
}
