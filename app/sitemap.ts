import type { MetadataRoute } from "next";

const origin = "https://hooka-relay.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/docs", "/privacy", "/terms"].map((path) => ({
    url: `${origin}${path}`,
  }));
}
