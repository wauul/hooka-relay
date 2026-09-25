import { publicStatus } from "@/lib/public-status";
import { StatusView } from "@/components/status-view";

export const metadata = { title: "Service status | Hooka Relay", description: "View recent aggregate webhook delivery outcomes for Hooka Relay.", alternates: { canonical: "/status" } };

export default async function StatusPage() {
  let data: Awaited<ReturnType<typeof publicStatus>> | null = null;
  try { data = await publicStatus(); } catch { /* Render the unavailable state. */ }
  return <StatusView data={data} />;
}
