import { db } from "@/lib/db";
import { ownEndpoint, userId, sameOrigin, apiError } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { workspaceTransaction } from "@/lib/workspaces";
import { endpointOptions, endpointOptionData } from "@/lib/endpoint-options";
import { publicEndpoint } from "@/lib/endpoint-config";
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { sameOrigin(req); const endpoint = await ownEndpoint((await params).id, "manage"); const input = endpointOptions.parse(await boundedJson(req, 16384));
    const app = await db.application.findUniqueOrThrow({ where: { id: endpoint.applicationId } });
    const result = await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => tx.endpoint.update({ where: { id: endpoint.id }, data: endpointOptionData(endpoint, input) }));
    return Response.json(publicEndpoint(result));
  } catch (e) { return apiError(e); }
}
