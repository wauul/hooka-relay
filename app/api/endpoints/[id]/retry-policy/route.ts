import { z } from "zod";
import { db } from "@/lib/db";
import { ownEndpoint, userId, sameOrigin, apiError } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { workspaceTransaction } from "@/lib/workspaces";
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req); const endpoint = await ownEndpoint((await params).id, "manage");
    const { retryPolicy } = z.object({ retryPolicy: z.enum(["STANDARD", "AGGRESSIVE", "RELAXED"]) }).parse(await boundedJson(req, 1024));
    const app = await db.application.findUniqueOrThrow({ where: { id: endpoint.applicationId } });
    await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => tx.endpoint.update({ where: { id: endpoint.id }, data: { retryPolicy } }));
    return Response.json({ retryPolicy });
  } catch (e) { return apiError(e); }
}
