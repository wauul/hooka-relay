import { afterEach, expect, it, vi } from "vitest";
import { emailContent, sendTransactionalEmail } from "../../lib/transactional-email";
import { safeAuthCallback, tokenHash } from "../../lib/auth-email";
vi.mock("../../lib/db", () => ({ db: {} }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const message = { id: "test", to: "test@example.com", subject: "Confirm your email", title: "Hello <script>alert(1)</script>", body: "One clear action.", action: "Confirm email", url: "https://relay.example.com/verify-email?token=abc" };
it("renders escaped branded HTML and readable plain text with the same CTA", async () => {
  const result = await emailContent(message);
  expect(result.html).toContain("hooka relay"); expect(result.html).not.toContain("<script>"); expect(result.html).toContain("&lt;script&gt;");
  expect(result.text).toContain(message.url); expect(result.text).toContain("One clear action.");
});
it("uses a configured reply-to, idempotency and both email formats", async () => {
  vi.stubEnv("RESEND_API_KEY", "test"); vi.stubEnv("RESEND_FROM", "Hooka <invites@example.com>"); vi.stubEnv("RESEND_REPLY_TO", "support@example.com"); vi.stubEnv("NEXTAUTH_URL", "https://relay.example.com");
  const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal("fetch", fetch); await sendTransactionalEmail(message);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ reply_to: "support@example.com", html: expect.any(String), text: expect.any(String) });
});
it("hashes capabilities and limits return paths to invitation review", () => {
  expect(tokenHash("secret")).toHaveLength(64); expect(tokenHash("secret")).not.toContain("secret");
  for (const path of ["https://evil.test", "//evil.test", "/profile", "/invites/accept?token=x\n"]) expect(safeAuthCallback(path)).toBe("/dashboard");
  expect(safeAuthCallback("/invites/accept?token=abc")).toBe("/invites/accept?token=abc");
});
