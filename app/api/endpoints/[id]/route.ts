import { db } from "@/lib/db";
import { ownEndpoint, apiError, sameOrigin, userId } from "@/lib/access";
import { workspaceTransaction } from "@/lib/workspaces";
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req);
    const endpoint = await ownEndpoint((await params).id, "manage");
    const app = await db.application.findUniqueOrThrow({ where: { id: endpoint.applicationId } });
    await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => tx.endpoint.delete({ where: { id: endpoint.id } }));
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
