import { ownApplication, userId, sameOrigin, apiError } from "@/lib/access";
import { enablePortal } from "@/lib/portal";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req);
    const app = await ownApplication((await params).id, "manage");
    const token = await enablePortal(app.id, await userId());
    return Response.json({ portalPath: `/portal/${token}` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiError(e); }
}
