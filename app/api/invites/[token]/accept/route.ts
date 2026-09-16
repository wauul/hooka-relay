import { apiError, sameOrigin, userId } from "@/lib/access";
import { acceptInvite } from "@/lib/workspaces";
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try { sameOrigin(req); return Response.json(await acceptInvite((await params).token, await userId())); }
  catch (e) { return apiError(e); }
}
