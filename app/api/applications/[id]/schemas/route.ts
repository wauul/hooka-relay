import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ownApplication, userId, sameOrigin, apiError } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { compileEventSchema } from "@/lib/event-schemas";
import { workspaceTransaction } from "@/lib/workspaces";
type Context = { params: Promise<{ id: string }> };
const eventType = z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/);
export async function GET(_req: Request, { params }: Context) {
  try { const app = await ownApplication((await params).id); return Response.json(await db.eventSchema.findMany({ where: { applicationId: app.id }, orderBy: { eventType: "asc" } })); } catch (e) { return apiError(e); }
}
async function mutate(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const app = await ownApplication((await params).id, "manage");
    const input = z.object({ eventType, schema: z.unknown() }).parse(await boundedJson(req, 18432));
    if (req.method === "PUT") compileEventSchema(input.schema);
    await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${app.id} FOR UPDATE`;
      if (req.method === "DELETE") { await tx.eventSchema.deleteMany({ where: { applicationId: app.id, eventType: input.eventType } }); return; }
      const count = await tx.eventSchema.count({ where: { applicationId: app.id } });
      const where = { applicationId_eventType: { applicationId: app.id, eventType: input.eventType } };
      if (count >= 50 && !await tx.eventSchema.findUnique({ where })) throw new Error("Application schema limit reached");
      const schema = input.schema as Prisma.InputJsonValue;
      await tx.eventSchema.upsert({ where, create: { applicationId: app.id, eventType: input.eventType, schema }, update: { schema } });
    });
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
export { mutate as PUT, mutate as DELETE };
