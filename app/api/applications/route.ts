import { db } from "@/lib/db";
import { z } from "zod";
import { userId, apiError, sameOrigin } from "@/lib/access";
import { newSecret } from "@/lib/security";
export async function GET() {
  try {
    return Response.json(
      await db.application.findMany({
        where: { userId: await userId() },
        include: { _count: { select: { endpoints: true, events: true } } },
        orderBy: { createdAt: "desc" },
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
      .object({ name: z.string().trim().min(1).max(80) })
      .parse(await req.json());
    return Response.json(
      await db.application.create({
        data: { name, userId: uid, apiKey: "hr_live_" + newSecret() },
      }),
      { status: 201 },
    );
  } catch (e) {
    return apiError(e);
  }
}
