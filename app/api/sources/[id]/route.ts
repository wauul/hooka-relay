import { z } from "zod";
import { db } from "@/lib/db";
import { ownApplication, apiError, sameOrigin, userId } from "@/lib/access";
import { workspaceTransaction } from "@/lib/workspaces";
import { boundedJson } from "@/lib/input-limits";
import { encryptSecret } from "@/lib/secrets";
import { newEndpointData } from "@/lib/endpoint-config";
import { validateOutboundUrl } from "@/lib/security";
import { manualVerifierSchema, providers } from "@/lib/webhook-providers";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  providerSecret: z.string().min(1).max(4096).optional(),
  destinationUrl: z.string().url().max(2000).optional(),
  manualConfig: manualVerifierSchema.optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
}).strict();
type Context = { params: Promise<{ id: string }> };
async function ownSource(id: string, action: "view" | "manage" = "view") {
  const source = await db.webhookSource.findUnique({ where: { id } });
  if (!source) throw new Error("NOT_FOUND");
  const app = await ownApplication(source.applicationId, action);
  return { source, app };
}
export async function GET(req: Request, { params }: Context) {
  try {
    const { source, app } = await ownSource((await params).id);
    const attempts = source.endpointId ? await db.deliveryAttempt.findMany({ where: { endpointId: source.endpointId }, orderBy: { createdAt: "desc" }, take: 30, include: { event: { select: { id: true, type: true } } } }) : [];
    const { encryptedProviderSecret, ...safe } = source;
    return Response.json({ ...safe, canManage: app.role !== "MEMBER", ingestionUrl: app.role === "MEMBER" ? undefined : `${new URL(process.env.NEXTAUTH_URL || req.url).origin}/api/inbound/${source.ingestionToken}`, ingestionToken: app.role === "MEMBER" ? undefined : source.ingestionToken, hasProviderSecret: !!encryptedProviderSecret, provider: providers[source.provider], attempts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const { source, app } = await ownSource((await params).id, "manage");
    const input = updateSchema.parse(await boundedJson(req, 8192));
    if (input.manualConfig && source.provider !== "CUSTOM") throw new Error("Manual verification only applies to custom sources");
    if (input.destinationUrl) await validateOutboundUrl(input.destinationUrl);
    const config = input.manualConfig ? manualVerifierSchema.parse(input.manualConfig) : undefined;
    const endpointData = input.destinationUrl ? await newEndpointData(app.id, input.destinationUrl, ["*"]) : null;
    const result = await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
      const current = await tx.webhookSource.findUniqueOrThrow({ where: { id: source.id } });
      let endpointId = current.endpointId;
      if (input.status === "ACTIVE") {
        if (!(input.providerSecret || current.encryptedProviderSecret) || !(input.destinationUrl || current.destinationUrl) || (current.provider === "CUSTOM" && !(config || current.manualConfig))) throw new Error("Complete signing and destination setup first");
        const delivered = endpointId && await tx.deliveryAttempt.findFirst({ where: { endpointId, status: "SUCCESS", event: { webhookSourceId: current.id } }, select: { id: true } });
        if (!current.lastVerifiedAt && !delivered) throw new Error("Verify a real webhook or deliver a simulation before activating");
      }
      if (input.destinationUrl) {
        if (endpointId) await tx.endpoint.update({ where: { id: endpointId }, data: { url: input.destinationUrl } });
        else {
          const endpoint = await tx.endpoint.create({ data: { ...endpointData!, kind: "INBOUND" } });
          endpointId = endpoint.id;
        }
      }
      if (endpointId && input.status) await tx.endpoint.update({ where: { id: endpointId }, data: { status: input.status === "PAUSED" ? "PAUSED" : "ACTIVE" } });
      return tx.webhookSource.update({ where: { id: source.id }, data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.providerSecret ? { encryptedProviderSecret: encryptSecret(input.providerSecret, app.id) } : {}),
        ...(input.destinationUrl ? { destinationUrl: input.destinationUrl, endpointId } : {}),
        ...(config ? { manualConfig: config } : {}),
        ...(input.status ? { status: input.status } : {}),
      } });
    });
    return Response.json({ id: result.id, status: result.status, endpointId: result.endpointId, destinationUrl: result.destinationUrl, hasProviderSecret: !!result.encryptedProviderSecret }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
export async function DELETE(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const { source, app } = await ownSource((await params).id, "manage");
    await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
      await tx.webhookSource.delete({ where: { id: source.id } });
      if (source.endpointId) await tx.endpoint.delete({ where: { id: source.endpointId } });
    });
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
