"use client";
import { Plus } from "lucide-react";

const icons: Record<string, { slug: string; color: string }> = {
  STRIPE: { slug: "stripe", color: "#635bff" }, GITHUB: { slug: "github", color: "#727a89" },
  SLACK: { slug: "slack", color: "#e7744c" }, TWILIO: { slug: "twilio", color: "#f22f46" },
  SHOPIFY: { slug: "shopify", color: "#79bd40" }, WOOCOMMERCE: { slug: "woocommerce", color: "#96588a" },
  LINEAR: { slug: "linear", color: "#5e6ad2" }, SQUARE: { slug: "square", color: "#4b5057" },
  INTERCOM: { slug: "intercom", color: "#286efa" }, MAILGUN: { slug: "mailgun", color: "#f06b58" },
  ZOOM: { slug: "zoom", color: "#2d8cff" }, FACEBOOK: { slug: "facebook", color: "#1877f2" },
  INSTAGRAM: { slug: "instagram", color: "#d2468f" }, WHATSAPP: { slug: "whatsapp", color: "#25d366" },
  TIKTOK: { slug: "tiktok", color: "#555b63" },
  ZENDESK: { slug: "zendesk", color: "#38a89d" }, TYPEFORM: { slug: "typeform", color: "#a6a8ad" },
  PADDLE: { slug: "paddle", color: "#ec7032" },
  LINKEDIN: { slug: "linkedin", color: "#0a66c2" },
};
export function ProviderIcon({ provider }: { provider: string }) {
  const icon = icons[provider];
  return <span className="provider-mark" aria-hidden="true" style={icon ? { color: icon.color } : undefined}>
    {icon ? <span className="provider-glyph" style={{ maskImage: `url(/providers/${icon.slug}.svg)` }} /> : <Plus size={22} />}
  </span>;
}
