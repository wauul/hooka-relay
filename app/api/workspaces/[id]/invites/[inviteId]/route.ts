import { apiError, sameOrigin, userId } from "@/lib/access";
import { workspaceTransaction, WorkspaceError } from "@/lib/workspaces";
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  try {
    sameOrigin(req);
    const { id, inviteId } = await params;
    await workspaceTransaction(id, await userId(), "invite", async (tx) => {
      const result = await tx.workspaceInvite.updateMany({
        where: { id: inviteId, workspaceId: id, status: "PENDING" },
        data: { status: "REVOKED" },
      });
      if (!result.count)
        throw new WorkspaceError(404, "Pending invite not found.");
    });
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
