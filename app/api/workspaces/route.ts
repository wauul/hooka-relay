import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, sameOrigin, userId } from "@/lib/access";
import { createWorkspace, defaultWorkspace } from "@/lib/workspaces";
export async function GET() {
  try {
    const uid = await userId();
    await defaultWorkspace(uid);
    return Response.json(
      await db.workspaceMember.findMany({
        where: { userId: uid },
        include: { workspace: true },
        orderBy: { joinedAt: "asc" },
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const uid = await userId();
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(await req.json());
    return Response.json(await createWorkspace(uid, name), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
