import AzureAD from "next-auth/providers/azure-ad";
import { z } from "zod";

const identity = z.object({
  sub: z.string().min(1),
  email: z.string().trim().email().max(254),
  // Microsoft email/username claims alone do not establish email ownership.
  xms_edov: z.literal(true),
  name: z.string().optional(),
});

export function microsoftProfile(profile: unknown) {
  const claims = identity.parse(profile);
  return { id: claims.sub, email: claims.email.toLowerCase(), name: claims.name ?? null, image: null };
}

export function microsoftProvider() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];
  return [AzureAD({
    clientId,
    clientSecret,
    tenantId: process.env.MICROSOFT_TENANT_ID || "common",
    name: "Microsoft",
    idToken: true,
    checks: ["pkce", "state"],
    // Use validated ID-token claims; no Graph/photo access is needed.
    profile: microsoftProfile,
  })];
}
