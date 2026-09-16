import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, sameOrigin, userId } from "@/lib/access";
import { membership, workspaceTransaction } from "@/lib/workspaces";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    const member = await membership(id, await userId());
    return Response.json({ ...await db.workspace.findUniqueOrThrow({ where: { id }, include: { members: { select: { id: true, userId: true, role: true, joinedAt: true, user: { select: { email: true } } }, orderBy: { joinedAt: "asc" } } } }), role: member.role, currentUserId: member.userId });
  } catch (e) { return apiError(e); }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const { id } = await params;
    const uid = await userId();
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(await req.json());
    return Response.json(await workspaceTransaction(id, uid, "manage", tx => tx.workspace.update({ where: { id }, data: { name } })));
  } catch (e) { return apiError(e); }
}
export async function DELETE(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const { id } = await params;
    await workspaceTransaction(id, await userId(), "delete", tx => tx.workspace.delete({ where: { id } }));
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
