import { expect, it } from "vitest";
import { outboundUrl, searchSite, faq } from "../../lib/site";
it("finds documentation and FAQ content case-insensitively", () => {
  expect(searchSite("HMAC").some((r) => r.href === "/docs#signatures")).toBe(
    true,
  );
  expect(searchSite("CLI").some((r) => r.href === "/docs#cli")).toBe(true);
  expect(searchSite("cookies").some((r) => r.category === "FAQ")).toBe(true);
  expect(searchSite("")).toEqual([]);
  expect(searchSite("no-such-doc-topic")).toEqual([]);
  expect(faq).toHaveLength(6);
});
it("attributes external links while preserving existing campaigns and fragments", () => {
  const url = new URL(
    outboundUrl(
      "https://github.com/wauul/hooka-relay?utm_source=custom#readme",
    ),
  );
  expect(url.searchParams.get("utm_source")).toBe("custom");
  expect(url.searchParams.get("utm_medium")).toBe("website");
  expect(url.hash).toBe("#readme");
  expect(outboundUrl(url.toString())).toBe(url.toString());
});
it.each([
  "/docs#faq",
  "https://hooka-relay.vercel.app/dashboard",
  "mailto:person@example.com",
  "#content",
])("does not change internal or non-HTTP navigation %s", (href) =>
  expect(outboundUrl(href)).toBe(href),
);
