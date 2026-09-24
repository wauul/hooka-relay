import { ImageResponse } from "next/og";

export const alt = "Hooka Relay: webhook delivery for SaaS teams";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 88, background: "#10171a", color: "#e8f0ec", fontFamily: "sans-serif" }}>
      <div style={{ color: "#adf7b6", fontSize: 32, marginBottom: 38 }}>hooka relay</div>
      <div style={{ fontSize: 67, fontWeight: 700, lineHeight: 1.12, maxWidth: 1000 }}>Webhook delivery for SaaS teams</div>
      <div style={{ color: "#a9b6ae", fontSize: 30, marginTop: 36 }}>Signed deliveries · Retries · Logs · Replay</div>
    </div>,
    size,
  );
}
