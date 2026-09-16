import { z } from "zod";
import { apiError, sameOrigin, userId } from "@/lib/access";
import { changeMember } from "@/lib/workspaces";
type Context = { params: Promise<{ id: string; userId: string }> };
export async function DELETE(req: Request, { params }: Context) {
  try { sameOrigin(req); const p = await params; return Response.json(await changeMember(p.id, await userId(), p.userId)); }
  catch (e) { return apiError(e); }
}
export async function PATCH(req: Request, { params }: Context) {
  try {
    sameOrigin(req); const p = await params;
    const { role } = z.object({ role: z.enum(["ADMIN", "MEMBER"]) }).parse(await req.json());
    return Response.json(await changeMember(p.id, await userId(), p.userId, role));
  } catch (e) { return apiError(e); }
}
