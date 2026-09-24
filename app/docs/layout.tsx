import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Webhook API Documentation | Hooka Relay",
  description:
    "Learn to send events, verify signed webhooks, understand retry behavior and use the Hooka Relay API.",
  alternates: { canonical: "/docs" },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
