import { expect, it, vi } from "vitest";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ default: { request: vi.fn() } }));
import { lookup } from "node:dns/promises";
import https from "node:https";
import { deliver } from "../../lib/deliver";
it("revalidates every attempt, pins the public answer, and blocks DNS rebinding", async () => {
  vi.mocked(lookup)
    .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }] as never)
    .mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
    ] as never);
  let options: any;
  vi.mocked(https.request).mockImplementation(((
    _url: unknown,
    opts: any,
    response: any,
  ) => {
    options = opts;
    return {
      on: vi.fn(),
      destroy: vi.fn(),
      end: () => {
        const listeners: Record<string, (...args: any[]) => void> = {};
        response({
          statusCode: 302,
          headers: { location: "https://127.0.0.1" },
          on: (event: string, handler: (...args: any[]) => void) => {
            listeners[event] = handler;
          },
        });
        listeners.end();
      },
    };
  }) as any);
  expect((await deliver("https://example.com", "{}", {})).code).toBe(302);
  const pinned = vi.fn();
  options.lookup("example.com", {}, pinned);
  expect(pinned).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  expect((await deliver("https://example.com", "{}", {})).error).toBe(
    "connection_error",
  );
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(https.request).toHaveBeenCalledTimes(1);
});
