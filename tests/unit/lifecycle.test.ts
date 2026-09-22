import { expect, it, vi, afterEach } from "vitest";
import { transformPayload } from "../../lib/payload-transform";
import { endpointOptions, endpointOptionData, outboundCustomHeaders, redactedDeliveryHeaders, endpointAvailability, effectiveEndpointStatus } from "../../lib/endpoint-options";
import { retryPlan } from "../../lib/retry-policy";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("transforms JSON in isolation and leaves unconfigured payloads unchanged", async () => {
  // Test output/isolation independently of CI scheduling; deadline rejection is
  // exercised below with the real clock and an infinite-loop transform.
  vi.spyOn(Date, "now").mockReturnValue(1000);
  expect(await transformPayload(null, { orderId: 42 })).toBe('{"orderId":42}');
  expect(await transformPayload('p => ({ order: p.orderId })', { orderId: 42 })).toBe('{"order":42}');
  expect(await transformPayload('p => [typeof process, typeof require, typeof fetch]', {})).toBe('["undefined","undefined","undefined"]');
});
it.each(['p => { while(true) {} }', 'p => "x".repeat(262145)', 'p => { let x=0; for(let i=0;i<40;i++) x=[x]; return x }', 'async p => p', 'p => undefined', 'p => new Array(100000000).fill("x")', 'p => require("fs")', 'p => import("node:fs")'])("rejects unsafe/unbounded transform %s", async source => {
  await expect(transformPayload(source, {})).rejects.toBeTruthy();
}, 5000);
it("protects protocol headers and encrypts custom credentials at rest", () => {
  for (const name of ["Host", "Content-Length", "WEBHOOK-SIGNATURE", "X-Webhook-Signature", "X-Idempotency-Key", "Connection", "Transfer-Encoding"]) expect(() => endpointOptions.parse({ customHeaders: { [name]: "forged" } })).toThrow();
  expect(() => endpointOptions.parse({ customHeaders: { Test: "ok\r\ninjected: true" } })).toThrow();
  const context = { id: "endpoint", applicationId: "app" }, data = endpointOptionData(context, { customHeaders: { Authorization: "Bearer secret" } });
  expect(data.customHeadersEncrypted).not.toContain("Bearer");
  expect(outboundCustomHeaders({ ...context, customHeadersEncrypted: data.customHeadersEncrypted! })).toEqual({ Authorization: "Bearer secret" });
  expect(() => outboundCustomHeaders({ ...context, id: "other", customHeadersEncrypted: data.customHeadersEncrypted! })).toThrow();
  expect(redactedDeliveryHeaders({ Authorization: "secret", "webhook-id": "event" }, { authorization: "secret" })).toEqual({ Authorization: "[redacted]", "webhook-id": "event" });
});
it("separates user pause, circuit disability and throttle admission", () => {
  const now = new Date();
  expect(endpointAvailability({ status: "PAUSED", nextDeliveryAt: null }, now).allowed).toBe(false);
  expect(endpointAvailability({ status: "ACTIVE", nextDeliveryAt: new Date(now.getTime() + 1) }, now).allowed).toBe(false);
  expect(endpointAvailability({ status: "ACTIVE", nextDeliveryAt: now }, now).allowed).toBe(true);
  expect(effectiveEndpointStatus({ status: "PAUSED", circuitState: "OPEN" })).toBe("PAUSED");
  expect(effectiveEndpointStatus({ status: "ACTIVE", circuitState: "OPEN" })).toBe("DISABLED");
  expect(effectiveEndpointStatus({ status: "ACTIVE", circuitState: "HALF_OPEN" })).toBe("ACTIVE");
});
it("extends retry configuration without changing TTL queue identities/defaults", () => {
  expect(retryPlan("STANDARD", 1).delay.ms).toBe(30000);
  vi.stubEnv("RETRY_STANDARD_QUEUES", "retry-delay-2m,retry-delay-5m");
  expect(retryPlan("STANDARD", 1).delay.ms).toBe(120000);
  expect(retryPlan("STANDARD", 3).exhausted).toBe(true);
  vi.stubEnv("RETRY_STANDARD_QUEUES", "unknown"); expect(() => retryPlan("STANDARD", 1)).toThrow();
});
