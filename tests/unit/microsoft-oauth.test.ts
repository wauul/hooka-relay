import { afterEach, expect, it, vi } from "vitest";
import { microsoftProfile, microsoftProvider } from "../../lib/microsoft-oauth";

afterEach(() => vi.unstubAllEnvs());

it("only enables Microsoft when both server credentials are configured", () => {
  vi.stubEnv("MICROSOFT_CLIENT_ID", "client");
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", "");
  expect(microsoftProvider()).toEqual([]);
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", "secret");
  vi.stubEnv("MICROSOFT_TENANT_ID", "");
  const [provider] = microsoftProvider();
  expect(provider.id).toBe("azure-ad");
  expect(provider.wellKnown).toContain("/common/v2.0/");
  expect(provider.options).toMatchObject({ idToken: true, checks: ["pkce", "state"] });
  expect(provider.options?.allowDangerousEmailAccountLinking).not.toBe(true);
  vi.stubEnv("MICROSOFT_TENANT_ID", "tenant-id");
  expect(microsoftProvider()[0].wellKnown).toContain("/tenant-id/v2.0/");
});

it("uses the stable subject and a normalized domain-verified email, without fetching Graph", () => {
  expect(microsoftProfile({ sub: "stable-id", name: "Example", email: " User@Example.com ", xms_edov: true, preferred_username: "other@example.com" }))
    .toEqual({ id: "stable-id", name: "Example", email: "user@example.com", image: null });
});

it.each([undefined, false, "true"])("rejects absent or untrusted email-domain verification %s", xms_edov => {
  expect(() => microsoftProfile({ sub: "stable-id", email: "user@example.com", xms_edov })).toThrow();
});

it.each([
  { sub: "stable-id", preferred_username: "user@example.com", xms_edov: true },
  { sub: "stable-id", email: "not-an-email", xms_edov: true },
  { sub: "", email: "user@example.com", xms_edov: true },
])("rejects missing subject/email without falling back to a mutable username", profile => {
  expect(() => microsoftProfile(profile)).toThrow();
});
