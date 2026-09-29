import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/docs", "/privacy", "/terms"].map((path) => ({
    url: `${SITE_ORIGIN}${path}`,
  }));
}
