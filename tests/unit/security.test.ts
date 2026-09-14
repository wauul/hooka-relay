import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
import { lookup } from "node:dns/promises";
import { signature, verifySignature, publicAddress, resolveEndpoint, newSecret } from "../../lib/security";
describe("HMAC signing and verification", () => {
  it.each(["", '{"order":42}', "x".repeat(1024 * 1024), '{"message":"你好 👋 café مرحبا"}'])("round-trips payload %#", payload => {
    const signed = signature(payload, "secret");
    expect(signed).toBe(signature(payload, "secret"));
    expect(signed).toBe("sha256=" + createHmac("sha256", "secret").update(payload).digest("hex"));
    expect(verifySignature(payload, signed, "secret")).toBe(true);
    expect(verifySignature(payload + "x", signed, "secret")).toBe(false);
    expect(verifySignature(payload, signed, "wrong-secret")).toBe(false);
  });
  it("is sensitive to raw whitespace rather than parsed JSON", () => expect(signature('{"x": 1}', "s")).not.toBe(signature('{"x":1}', "s")));
  it.each([undefined, null, "", "sha256=bad", "x".repeat(1000), "sha256=" + "0".repeat(64)])("rejects malformed signature %# without throwing", value => expect(verifySignature("body", value, "s")).toBe(false));
  it("generates distinct 256-bit hex secrets", () => { const a = newSecret(); expect(a).toMatch(/^[a-f0-9]{64}$/); expect(newSecret()).not.toBe(a); });
});
describe("destination safety", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(["127.0.0.1", "10.1.1.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1", "0.0.0.0", "224.0.0.1", "invalid"])("rejects reserved address %s", ip => expect(publicAddress(ip)).toBe(false));
  it("accepts public IPv4 and IPv6", () => { expect(publicAddress("8.8.8.8")).toBe(true); expect(publicAddress("2606:4700:4700::1111")).toBe(true); });
  it.each(["http://example.com", "https://user:password@example.com", "https://example.com:8443"])("rejects unsafe URL %s before DNS", async url => { await expect(resolveEndpoint(url)).rejects.toThrow("public HTTPS"); expect(lookup).not.toHaveBeenCalled(); });
  it("rejects mixed public/private DNS results", async () => { vi.mocked(lookup).mockResolvedValue([{address:"8.8.8.8",family:4},{address:"127.0.0.1",family:4}] as never); await expect(resolveEndpoint("https://example.com")).rejects.toThrow("Private"); });
  it("rejects empty DNS results", async () => { vi.mocked(lookup).mockResolvedValue([] as never); await expect(resolveEndpoint("https://example.com")).rejects.toThrow("Private"); });
  it("returns a validated address for pinning", async () => { const address={address:"8.8.8.8",family:4}; vi.mocked(lookup).mockResolvedValue([address] as never); expect((await resolveEndpoint("https://example.com/hook")).address).toEqual(address); expect(lookup).toHaveBeenCalledWith("example.com",{all:true}); });
});
