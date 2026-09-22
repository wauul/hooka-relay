import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ endpoint: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() }, deliveryAttempt: { findMany: vi.fn() } }));
vi.mock("../../lib/db", () => ({ db: mocks }));
import { diagnose } from "../../lib/diagnosis";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup() {
  vi.stubEnv("GROQ_API_KEY", "test-only");
  mocks.endpoint.findUniqueOrThrow.mockResolvedValue({ consecutiveFailures: 3, diagnosedAt: null });
  mocks.endpoint.updateMany.mockResolvedValue({ count: 1 });
  const rows = [200, 401, 401, 401].map((code, i) => ({ httpStatusCode: code, status: code === 200 ? "SUCCESS" : "FAILED", createdAt: new Date(1700000000000 + i * 1000), durationMs: 100, responseBody: code === 401 ? "token expired" : "ok", responseHeaders: {}, error: null })).reverse();
  mocks.deliveryAttempt.findMany.mockResolvedValue(rows);
  const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ likelyCause: "An expired credential may explain the 401s.", suggestedFix: "Check the receiver credential.", confidence: "medium" }) } }] }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("grounds diagnosis in timestamped cross-attempt evidence including the success baseline", async () => {
  const fetcher = setup(); await diagnose("ep");
  expect(mocks.deliveryAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, where: { endpointId: "ep", status: { not: "SKIPPED_CIRCUIT_OPEN" } } }));
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  const evidence = JSON.parse(body.messages[1].content);
  expect(body.max_completion_tokens).toBe(700); expect(evidence.pattern.summary).toContain("latest 3 returned HTTP 401");
  expect(evidence.attempts).toHaveLength(4); expect(evidence.attempts.at(-1).status).toBe(200);
  expect(mocks.endpoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ep", consecutiveFailures: { gte: 3 }, diagnosedAt: null }, data: expect.objectContaining({ diagnosis: expect.objectContaining({ pattern: expect.objectContaining({ active: true }) }) }) }));
});
it("spends no LLM call during the existing cooldown or without a key", async () => {
  const fetcher = setup(); mocks.endpoint.findUniqueOrThrow.mockResolvedValue({ consecutiveFailures: 3, diagnosedAt: new Date() });
  await diagnose("ep"); expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("GROQ_API_KEY", ""); await diagnose("ep"); expect(fetcher).not.toHaveBeenCalled();
});
it("does not diagnose a recovered endpoint even if the earlier counter read was stale", async () => {
  const fetcher = setup(); mocks.deliveryAttempt.findMany.mockResolvedValue([{ status: "SUCCESS", createdAt: new Date(), httpStatusCode: 200, durationMs: 10, responseBody: "ok", error: null }]);
  await diagnose("ep"); expect(fetcher).not.toHaveBeenCalled(); expect(mocks.endpoint.updateMany).not.toHaveBeenCalled();
});
it("rejects malformed model output without storing it", async () => {
  const fetcher = setup(); fetcher.mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: "not JSON" } }] }));
  await expect(diagnose("ep")).rejects.toThrow(); expect(mocks.endpoint.updateMany).not.toHaveBeenCalled();
});
