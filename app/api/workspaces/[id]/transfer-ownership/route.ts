import { z } from "zod";
import { apiError, sameOrigin, userId } from "@/lib/access";
import { transferOwnership } from "@/lib/workspaces";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req);
    const { userId: target } = z.object({ userId: z.string().min(1) }).parse(await req.json());
    return Response.json(await transferOwnership((await params).id, await userId(), target));
  } catch (e) { return apiError(e); }
}
