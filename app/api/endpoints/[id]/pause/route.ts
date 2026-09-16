import { db } from "@/lib/db";
import { ownEndpoint, apiError, sameOrigin, userId } from "@/lib/access";
import { endpointTransition } from "@/lib/endpoint-status";
import { workspaceTransaction } from "@/lib/workspaces";
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req);
    const endpoint = await ownEndpoint((await params).id, "manage");
    const app = await db.application.findUniqueOrThrow({ where: { id: endpoint.applicationId } });
    return Response.json(await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => tx.endpoint.update({ where: { id: endpoint.id }, data: { status: endpointTransition(endpoint.status, "pause") } })));
  } catch (e) { return apiError(e); }
}
