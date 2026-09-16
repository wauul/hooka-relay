import { apiError, sameOrigin, userId } from "@/lib/access";
import { leaveWorkspace } from "@/lib/workspaces";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    return Response.json(
      await leaveWorkspace((await params).id, await userId()),
    );
  } catch (e) {
    return apiError(e);
  }
}
