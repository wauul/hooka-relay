import { publishEventType } from "@/lib/event-catalog";
import { z } from "zod";
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
    const input = z.object({ eventType, schema: z.unknown().optional() }).parse(await boundedJson(req, 18432));
    if (req.method === "PUT") compileEventSchema(input.schema);
    await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${app.id} FOR UPDATE`;
      const latest = await tx.eventTypeVersion.findFirst({ where: { applicationId: app.id, eventType: input.eventType }, orderBy: { version: "desc" } });
      await publishEventType(tx, app.id, { eventType: input.eventType, description: latest?.description || "", schema: req.method === "DELETE" ? null : input.schema });
    });
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
export { mutate as PUT, mutate as DELETE };
