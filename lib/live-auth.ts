import { applicationForKey } from "./api-keys";
import { db } from "./db";

export class LiveAuthError extends Error {
  constructor(message: string, public code = 4401) { super(message); }
}

export async function authorizeLiveSource(apiKey: string, reference: string) {
  if (!apiKey || apiKey.length > 256 || !reference || reference.length > 100) throw new LiveAuthError("Invalid subscription");
  const application = await applicationForKey(apiKey, "READ");
  if (!application) throw new LiveAuthError("Invalid API key");
  const matches = await db.webhookSource.findMany({
    where: { applicationId: application.id, OR: [{ id: reference }, { name: reference }] },
    select: { id: true, name: true, status: true }, take: 2,
  });
  if (!matches.length) throw new LiveAuthError("Source not found", 4404);
  if (matches.length !== 1) throw new LiveAuthError("Source name is ambiguous; use its ID", 4409);
  if (matches[0].status === "PAUSED") throw new LiveAuthError("Source is paused", 4403);
  return { sourceId: matches[0].id, sourceName: matches[0].name, applicationId: application.id };
}
