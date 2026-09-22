import { z } from "zod";
import { db } from "@/lib/db";
import { ownEndpoint, apiError, sameOrigin, userId } from "@/lib/access";
import { workspaceTransaction } from "@/lib/workspaces";
import { boundedJson } from "@/lib/input-limits";
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req); const endpoint = await ownEndpoint((await params).id, "manage"), uid = await userId();
    const { signatureFormat } = z.object({ signatureFormat: z.enum(["LEGACY", "STANDARD"]) }).parse(await boundedJson(req, 1024));
    const app = await db.application.findUniqueOrThrow({ where: { id: endpoint.applicationId } });
    await workspaceTransaction(app.workspaceId, uid, "manage", async tx => {
      await tx.endpoint.update({ where: { id: endpoint.id }, data: { signatureFormat } });
      await tx.auditLog.create({ data: { applicationId: app.id, endpointId: endpoint.id, actorId: uid, action: "signature_format." + signatureFormat.toLowerCase(), secretVersion: endpoint.secretVersion } });
    });
    return Response.json({ signatureFormat });
  } catch (error) { return apiError(error); }
}
