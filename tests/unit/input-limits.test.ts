import { expect, it, vi } from "vitest";
import { boundedJson, checkJsonDepth } from "../../lib/input-limits";
it("rejects declared size before consuming any bytes", async () => {
  const read = vi.fn();
  await expect(
    boundedJson({
      headers: new Headers({ "content-length": "262145" }),
      body: { getReader: read },
    } as unknown as Request),
  ).rejects.toMatchObject({ status: 413 });
  expect(read).not.toHaveBeenCalled();
});
it("cancels chunked oversized streams even when content-length lies", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024));
    },
    cancel,
  });
  const req = new Request("https://example.com", {
    method: "POST",
    body,
    duplex: "half",
    headers: { "content-length": "1" },
  } as RequestInit);
  await expect(boundedJson(req, 2048)).rejects.toMatchObject({ status: 413 });
  expect(cancel).toHaveBeenCalledOnce();
});
it("accepts exact byte limit and correctly decodes split multibyte data", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ value: "\u00e9" }));
  const body = new ReadableStream({
    start(c) {
      for (const b of bytes) c.enqueue(new Uint8Array([b]));
      c.close();
    },
  });
  expect(
    await boundedJson(
      new Request("https://example.com", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
      bytes.length,
    ),
  ).toEqual({ value: "\u00e9" });
});
it("rejects over-deep objects and arrays but ignores quoted brackets", () => {
  expect(() => checkJsonDepth("[".repeat(33) + "0" + "]".repeat(33))).toThrow(
    "nesting",
  );
  expect(() =>
    checkJsonDepth('{"a":'.repeat(33) + "0" + "}".repeat(33)),
  ).toThrow("nesting");
  expect(() =>
    checkJsonDepth("[".repeat(32) + "0" + "]".repeat(32)),
  ).not.toThrow();
  expect(() =>
    checkJsonDepth(JSON.stringify({ data: '\\"' + "[".repeat(100) })),
  ).not.toThrow();
});
it("rejects missing or malformed JSON", async () => {
  await expect(
    boundedJson(new Request("https://example.com")),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    boundedJson(
      new Request("https://example.com", { method: "POST", body: "{" }),
    ),
  ).rejects.toThrow();
});
