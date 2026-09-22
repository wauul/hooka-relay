import { effectiveEndpointStatus } from "./endpoint-options";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { newSecret, resolveEndpoint } from "./security";
import { encryptEndpointSecret } from "./endpoint-secrets";
export async function newEndpointData(applicationId: string, url: string, eventTypes: string[]) {
  const input = z.object({ url: z.string().url().max(2000), eventTypes: z.array(z.string().min(1).max(120).regex(/^(\*|[A-Za-z0-9_.:-]+)$/)).min(1).max(50) }).parse({ url, eventTypes });
  await resolveEndpoint(input.url);
  const context = { applicationId, id: randomUUID(), secretVersion: 1 };
  return { ...context, ...input, signatureFormat: "STANDARD" as const, secret: encryptEndpointSecret(newSecret(), context) };
}
export function publicEndpoint<T extends { secret: string; previousSecret?: string | null; customHeadersEncrypted?: string | null; status: string; circuitState: string }>(endpoint: T) {
  const { secret: _secret, previousSecret: _previous, customHeadersEncrypted: _headers, ...safe } = endpoint;
  return { ...safe, userStatus: endpoint.status, status: effectiveEndpointStatus(endpoint) };
}
