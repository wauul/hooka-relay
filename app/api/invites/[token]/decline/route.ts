import { apiError, sameOrigin, userId } from "@/lib/access";
import { declineInvite } from "@/lib/workspaces";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    sameOrigin(req);
    return Response.json(
      await declineInvite((await params).token, await userId()),
    );
  } catch (e) {
    return apiError(e);
  }
}
