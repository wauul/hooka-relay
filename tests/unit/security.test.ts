import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
import { lookup } from "node:dns/promises";
import {
  signature,
  verifySignature,
  publicAddress,
  resolveEndpoint,
  newSecret,
} from "../../lib/security";
describe("HMAC signing and verification", () => {
  it.each([
    "",
    '{"order":42}',
    "x".repeat(1024 * 1024),
    '{"message":"你好 👋 café مرحبا"}',
  ])("round-trips payload %#", (payload) => {
    const signed = signature(payload, "secret");
    expect(signed).toBe(signature(payload, "secret"));
    expect(signed).toBe(
      "sha256=" + createHmac("sha256", "secret").update(payload).digest("hex"),
    );
    expect(verifySignature(payload, signed, "secret")).toBe(true);
    expect(verifySignature(payload + "x", signed, "secret")).toBe(false);
    expect(verifySignature(payload, signed, "wrong-secret")).toBe(false);
  });
  it("is sensitive to raw whitespace rather than parsed JSON", () =>
    expect(signature('{"x": 1}', "s")).not.toBe(signature('{"x":1}', "s")));
  it.each([
    undefined,
    null,
    "",
    "sha256=bad",
    "x".repeat(1000),
    "sha256=" + "0".repeat(64),
  ])("rejects malformed signature %# without throwing", (value) =>
    expect(verifySignature("body", value, "s")).toBe(false),
  );
  it("generates distinct 256-bit hex secrets", () => {
    const a = newSecret();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(newSecret()).not.toBe(a);
  });
});
describe("destination safety", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([
    "127.0.0.1",
    "10.1.1.1",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
    "224.0.0.1",
    "invalid",
  ])("rejects reserved address %s", (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it("accepts public IPv4 and IPv6", () => {
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it.each([
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com:8443",
  ])("rejects unsafe URL %s before DNS", async (url) => {
    await expect(resolveEndpoint(url)).rejects.toThrow("public HTTPS");
    expect(lookup).not.toHaveBeenCalled();
  });
  it("rejects mixed public/private DNS results", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    await expect(resolveEndpoint("https://example.com")).rejects.toThrow(
      "Private",
    );
  });
  it("rejects empty DNS results", async () => {
    vi.mocked(lookup).mockResolvedValue([] as never);
    await expect(resolveEndpoint("https://example.com")).rejects.toThrow(
      "Private",
    );
  });
  it("returns a validated address for pinning", async () => {
    const address = { address: "8.8.8.8", family: 4 };
    vi.mocked(lookup).mockResolvedValue([address] as never);
    expect((await resolveEndpoint("https://example.com/hook")).address).toEqual(
      address,
    );
    expect(lookup).toHaveBeenCalledWith("example.com", { all: true });
  });
});

describe("SSRF pre-DNS rejection and rebinding", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([
    "localhost",
    "LOCALHOST.",
    "api.localhost",
    "database",
    "service.internal",
    "printer.local",
    "router.lan",
    "nas.home",
    "metadata.google.internal",
  ])("blocks internal hostname %s before lookup", async (host) => {
    await expect(resolveEndpoint("https://" + host)).rejects.toThrow(
      "Internal hostnames",
    );
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    "ftp://example.com",
    "file:///etc/passwd",
    "gopher://example.com",
    "data:text/plain,hello",
  ])("rejects protocol %s", async (url) => {
    await expect(resolveEndpoint(url)).rejects.toThrow("public HTTPS");
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([
    "0.1.2.3",
    "10.255.255.255",
    "172.31.255.255",
    "192.168.255.255",
    "127.255.255.254",
    "169.254.255.254",
    "100.64.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "fe80::1",
    "fdff::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
  ])("blocks reserved DNS answer %s", async (address) => {
    vi.mocked(lookup).mockResolvedValue([
      { address, family: address.includes(":") ? 6 : 4 },
    ] as never);
    await expect(resolveEndpoint("https://example.com")).rejects.toThrow(
      "Private",
    );
  });
  it("re-resolves the same destination and rejects changed private answers", async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }] as never)
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }] as never);
    await expect(
      resolveEndpoint("https://example.com"),
    ).resolves.toHaveProperty("address.address", "8.8.8.8");
    await expect(resolveEndpoint("https://example.com")).rejects.toThrow(
      "Private",
    );
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("fails closed on DNS failure and oversized URLs", async () => {
    vi.mocked(lookup).mockRejectedValue(new Error("DNS unavailable"));
    await expect(resolveEndpoint("https://example.com")).rejects.toThrow(
      "DNS unavailable",
    );
    await expect(
      resolveEndpoint("https://example.com/" + "a".repeat(2048)),
    ).rejects.toThrow("2048");
  });
});
