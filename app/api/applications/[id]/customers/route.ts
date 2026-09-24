import { z } from "zod";
import { db } from "@/lib/db";
import { boundedJson } from "@/lib/input-limits";
import { ownApplication, apiError, sameOrigin, userId } from "@/lib/access";
import { workspaceTransaction, WorkspaceError } from "@/lib/workspaces";

type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  try {
    const app = await ownApplication((await params).id);
    if (app.customerMode !== "ISOLATED") throw new WorkspaceError(404, "Customers are not enabled");
    return Response.json(await db.customer.findMany({ where: { applicationId: app.id }, select: { id: true, externalId: true, name: true, createdAt: true, portalTokenHash: true, _count: { select: { endpoints: true } } }, orderBy: { createdAt: "asc" } }).then(rows => rows.map(({ portalTokenHash, ...row }) => ({ ...row, portalEnabled: !!portalTokenHash }))));
  } catch (error) { return apiError(error); }
}
export async function POST(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const app = await ownApplication((await params).id, "manage");
    if (app.customerMode !== "ISOLATED") throw new WorkspaceError(409, "Create an isolated application first");
    const input = z.object({ externalId: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/), name: z.string().trim().min(1).max(100) }).parse(await boundedJson(req, 4096));
    const customer = await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
      if (await tx.customer.count({ where: { applicationId: app.id } }) >= 1000) throw new WorkspaceError(409, "Customer limit reached");
      if (await tx.customer.findUnique({ where: { applicationId_externalId: { applicationId: app.id, externalId: input.externalId } } })) throw new WorkspaceError(409, "Customer identifier already used");
      return tx.customer.create({ data: { applicationId: app.id, ...input }, select: { id: true, externalId: true, name: true, createdAt: true } });
    });
    return Response.json(customer, { status: 201 });
  } catch (error) { return apiError(error); }
}
