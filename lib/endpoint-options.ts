import { z } from "zod";
import { encryptEndpointSecret, decryptEndpointSecret } from "./endpoint-secrets";
const headers = z.record(z.string(), z.string().max(1024)).superRefine((value, ctx) => {
  if (Object.keys(value).length > 10 || Buffer.byteLength(JSON.stringify(value)) > 8192) ctx.addIssue({ code: "custom", message: "At most 10 headers / 8 KiB" });
  for (const [name, content] of Object.entries(value)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || /^(host|content-type|content-length|connection|transfer-encoding|te|trailer|upgrade|proxy-authorization|proxy-connection|expect|accept-encoding)$/i.test(name) || /^(webhook-|x-webhook-|x-idempotency-key)/i.test(name) || /[^\x20-\x7e]/.test(content))
      ctx.addIssue({ code: "custom", message: "Invalid or reserved outbound header" });
  }
});
export const endpointOptions = z.object({
  environment: z.string().trim().min(1).max(64).optional(),
  kind: z.enum(["BUSINESS", "OPERATIONAL"]).optional(),
  customHeaders: headers.optional(),
  deliveryRatePerMinute: z.number().int().min(1).max(6000).nullable().optional(),
  transform: z.string().max(4096).nullable().optional(),
});
export function endpointOptionData(context: { id: string; applicationId: string }, input: z.infer<typeof endpointOptions>) {
  const { customHeaders, ...rest } = endpointOptions.parse(input);
  return { ...rest, ...(customHeaders === undefined ? {} : { customHeadersEncrypted: encryptEndpointSecret(JSON.stringify(customHeaders), { ...context, id: context.id + ":headers", secretVersion: 1 }) }) };
}
export function outboundCustomHeaders(endpoint: { id: string; applicationId: string; customHeadersEncrypted: string | null }) {
  return endpoint.customHeadersEncrypted ? headers.parse(JSON.parse(decryptEndpointSecret(endpoint.customHeadersEncrypted, { ...endpoint, id: endpoint.id + ":headers", secretVersion: 1 }))) : {};
}
export function endpointAvailability(endpoint: { status: string; nextDeliveryAt: Date | null }, now = new Date()) {
  if (endpoint.status === "PAUSED") return { allowed: false, dueAt: new Date(now.getTime() + 30000) };
  if (endpoint.nextDeliveryAt && endpoint.nextDeliveryAt > now) return { allowed: false, dueAt: endpoint.nextDeliveryAt };
  return { allowed: true, dueAt: now };
}
export function effectiveEndpointStatus(endpoint: { status: string; circuitState: string }) {
  return endpoint.status === "PAUSED" ? "PAUSED" : endpoint.circuitState === "OPEN" ? "DISABLED" : "ACTIVE";
}

export function redactedDeliveryHeaders(headers: Record<string, string>, custom: Record<string, string>) {
  const sensitive = new Set(Object.keys(custom).map(name => name.toLowerCase()));
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, sensitive.has(name.toLowerCase()) ? "[redacted]" : value]));
}
