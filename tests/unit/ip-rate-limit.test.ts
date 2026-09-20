import { expect, it, vi } from "vitest";
vi.mock("../../lib/db", () => ({ db: { $queryRaw: vi.fn() } }));
import { requestIp } from "../../lib/ip-rate-limit";
it("does not trust client-supplied forwarding headers outside Vercel", () => {
  vi.stubEnv("VERCEL", "");
  expect(
    requestIp(
      new Request("https://example.com", {
        headers: {
          "x-forwarded-for": "8.8.8.8",
          "x-vercel-forwarded-for": "1.1.1.1",
        },
      }),
    ),
  ).toBe("unidentified");
  vi.unstubAllEnvs();
});
it("uses the Vercel-controlled header and fails closed for malformed input", () => {
  vi.stubEnv("VERCEL", "1");
  expect(
    requestIp(
      new Request("https://example.com", {
        headers: { "x-vercel-forwarded-for": "8.8.8.8" },
      }),
    ),
  ).toBe("8.8.8.8");
  expect(
    requestIp(
      new Request("https://example.com", {
        headers: { "x-vercel-forwarded-for": "fake" },
      }),
    ),
  ).toBe("unidentified");
  vi.unstubAllEnvs();
});
