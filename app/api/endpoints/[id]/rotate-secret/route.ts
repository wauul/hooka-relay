import { db } from "@/lib/db";
import { ownEndpoint, apiError, sameOrigin, userId } from "@/lib/access";
import { workspaceTransaction } from "@/lib/workspaces";
import { rotateSigningSecret } from "@/lib/signing-secrets";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req); const endpoint = await ownEndpoint((await params).id, "manage"), uid = await userId();
    const app = await db.application.findUniqueOrThrow({ where: { id: endpoint.applicationId } });
    const result = await workspaceTransaction(app.workspaceId, uid, "manage", tx => rotateSigningSecret(tx, endpoint.id, uid));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
