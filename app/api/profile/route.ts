import { db } from "@/lib/db";
import { apiError, sameOrigin, userId } from "@/lib/access";
import { displayNameSchema, userDisplayName } from "@/lib/display-name";
const select = { id: true, email: true, displayName: true };
export async function GET() {
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { id: await userId() },
      select,
    });
    return Response.json({ ...user, displayName: userDisplayName(user) });
  } catch (e) {
    return apiError(e);
  }
}
export async function PATCH(req: Request) {
  try {
    sameOrigin(req);
    const id = await userId();
    const displayName = displayNameSchema.parse((await req.json()).displayName);
    const user = await db.user.update({
      where: { id },
      data: { displayName },
      select,
    });
    return Response.json(user);
  } catch (e) {
    return apiError(e);
  }
}
