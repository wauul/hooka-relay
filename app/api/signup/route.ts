import { ipRateLimit } from "@/lib/ip-rate-limit";
import { userDisplayName } from "@/lib/display-name";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, sameOrigin } from "@/lib/access";
import { invitationDetails, WorkspaceError } from "@/lib/workspaces";
export async function POST(req: Request) {
  try {
    const limited = await ipRateLimit(req, "auth");
    if (limited) return limited;
    sameOrigin(req);
    const data = z
      .object({
        email: z.string().email().max(254),
        inviteToken: z.string().max(128).optional(),
        password: z.string().min(12).max(72),
      })
      .parse(await req.json());
    if (data.inviteToken) {
      const invite = await invitationDetails(data.inviteToken);
      if (invite.email !== data.email.toLowerCase().trim())
        throw new WorkspaceError(403, "Use the invited email address.");
    }
    await db.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        displayName: userDisplayName({
          email: data.email.toLowerCase().trim(),
        }),
        hashedPassword: await hash(data.password, 12),
      },
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
