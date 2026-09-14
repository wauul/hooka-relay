import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, sameOrigin } from "@/lib/access";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const data = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(12).max(72),
      })
      .parse(await req.json());
    await db.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        hashedPassword: await hash(data.password, 12),
      },
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
