import { z } from "zod";
import { db } from "@/lib/db";
import { boundedJson } from "@/lib/input-limits";
import { ownApplication, apiError, sameOrigin, userId } from "@/lib/access";
import { workspaceTransaction } from "@/lib/workspaces";
import { newSecret } from "@/lib/security";
import { decryptSecret, encryptSecret, hashApiKey } from "@/lib/secrets";

type Context = { params: Promise<{ id: string; customerId: string }> };
export async function POST(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const { id, customerId } = await params;
    const app = await ownApplication(id, "manage");
    if (app.customerMode !== "ISOLATED") throw new Error("NOT_FOUND");
    const { action } = z.object({ action: z.enum(["issue", "rotate", "revoke"]) }).parse(await boundedJson(req, 1024));
    const token = await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} AND "applicationId" = ${app.id} FOR UPDATE`;
      const customer = await tx.customer.findFirst({ where: { id: customerId, applicationId: app.id } });
      if (!customer) throw new Error("NOT_FOUND");
      if (action === "revoke") {
        await tx.customer.update({ where: { id: customer.id }, data: { portalTokenHash: null, portalTokenEncrypted: null } });
        return null;
      }
      if (action === "issue" && customer.portalTokenEncrypted) return decryptSecret(customer.portalTokenEncrypted, customer.id);
      const fresh = newSecret();
      await tx.customer.update({ where: { id: customer.id }, data: { portalTokenHash: hashApiKey(fresh), portalTokenEncrypted: encryptSecret(fresh, customer.id) } });
      return fresh;
    });
    return Response.json({ portalPath: token ? `/portal/${token}` : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
