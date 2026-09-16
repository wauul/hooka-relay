import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, sameOrigin, userId } from "@/lib/access";
import { inviteMember, membership } from "@/lib/workspaces";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  try {
    const { id } = await params;
    await membership(id, await userId(), "invite");
    return Response.json(
      await db.workspaceInvite.findMany({
        where: {
          workspaceId: id,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const uid = await userId();
    const input = z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        role: z.enum(["ADMIN", "MEMBER"]),
      })
      .parse(await req.json());
    return Response.json(
      await inviteMember((await params).id, uid, input.email, input.role),
      { status: 201 },
    );
  } catch (e) {
    return apiError(e);
  }
}
