import { afterEach, expect, it, vi } from "vitest";
import { sendInvite } from "../../lib/invite-email";
import { eventRateLimit } from "../../lib/rate-limit";
vi.mock("../../lib/db", () => ({ db: {} }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const invite = {
  id: "invite-1",
  email: "test@example.com",
  token: "opaque-token",
  workspace: { name: "Team" },
  expiresAt: new Date("2026-09-23T00:00:00Z"),
};
it("requires email configuration", async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  await expect(sendInvite(invite)).rejects.toThrow("configuration");
});
it("sends a scoped invitation with an idempotency header and handles provider failure", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("RESEND_FROM", "Hooka <invites@example.com>");
  vi.stubEnv("NEXTAUTH_URL", "https://relay.example.com");
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetch);
  await sendInvite(invite);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(options.headers["Idempotency-Key"]).toBe("workspace-invite-invite-1");
  expect(JSON.parse(options.body)).toMatchObject({
    to: [invite.email],
    text: expect.stringContaining(
      "https://relay.example.com/invites/accept?token=opaque-token",
    ),
  });
  fetch.mockResolvedValueOnce({ ok: false });
  await expect(sendInvite(invite)).rejects.toThrow("send failed");
});
it("uses a positive integer rate limit", () => {
  vi.stubEnv("EVENTS_RATE_LIMIT_PER_MINUTE", "");
  expect(eventRateLimit()).toBe(100);
  vi.stubEnv("EVENTS_RATE_LIMIT_PER_MINUTE", "3");
  expect(eventRateLimit()).toBe(3);
  for (const value of ["0", "-1", "1.5", "invalid"]) {
    vi.stubEnv("EVENTS_RATE_LIMIT_PER_MINUTE", value);
    expect(() => eventRateLimit()).toThrow();
  }
});
