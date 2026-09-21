import { afterEach, expect, it, vi } from "vitest";
import { classifySupport, generateSupport } from "../../lib/support-model";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function mockResponse(status = 200, finish = "stop") {
  vi.stubEnv("GROQ_API_KEY", "test-key");
  const fetcher = vi.fn().mockResolvedValue({ ok: status === 200, json: async () => ({ choices: [{ finish_reason: finish, message: { content: '{"inScope":true,"reason":"product question"}' } }] }) }); vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("uses a small classifier budget, JSON mode and untrusted question envelope", async () => {
  const fetcher = mockResponse(); await classifySupport("Hooka Relay retries?"); const options = fetcher.mock.calls[0][1]; const body = JSON.parse(options.body);
  expect(body.max_completion_tokens).toBe(256); expect(body.response_format).toEqual({ type: "json_object" }); expect(body.messages).toHaveLength(2); expect(JSON.parse(body.messages[1].content)).toEqual({ question: "Hooka Relay retries?" }); expect(options.signal).toBeInstanceOf(AbortSignal);
});
it("sends grounded excerpts and bounded-stage token budget for generation", async () => {
  const fetcher = mockResponse(); const chunks = [{ source: "README.md", text: "Use timestamp signatures" }]; await generateSupport({ question: "Signatures?", history: [] }, chunks); const body = JSON.parse(fetcher.mock.calls[0][1].body); expect(body.max_completion_tokens).toBe(768); expect(JSON.parse(body.messages[1].content).documentation).toEqual(chunks); expect(body.messages[0].content).toContain("ONLY from");
});
it("does not retry provider failures or truncated responses", async () => {
  const fetcher = mockResponse(429); await expect(classifySupport("Hooka Relay?")).rejects.toThrow("temporarily unavailable"); expect(fetcher).toHaveBeenCalledOnce();
  mockResponse(200, "length"); await expect(classifySupport("Hooka Relay?")).rejects.toThrow("Incomplete");
});
it("never calls a provider without a configured key", async () => {
  const fetcher = mockResponse(); vi.stubEnv("GROQ_API_KEY", ""); await expect(classifySupport("Hooka Relay?")).rejects.toThrow("not configured"); expect(fetcher).not.toHaveBeenCalled();
});
