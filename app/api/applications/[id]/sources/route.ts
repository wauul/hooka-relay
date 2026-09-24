import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ownApplication, apiError, sameOrigin, userId } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { workspaceTransaction } from "@/lib/workspaces";
import { providerNames, providers } from "@/lib/webhook-providers";

const inputSchema = z.object({ name: z.string().trim().min(1).max(100), provider: z.enum(providerNames) });
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  try {
    const app = await ownApplication((await params).id);
    const sources = await db.webhookSource.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" }, include: { endpoint: { select: { circuitState: true, retryPolicy: true } } } });
    return Response.json(sources.map(({ encryptedProviderSecret, verificationTokenHash, ...source }) => ({ ...source, ingestionToken: app.role === "MEMBER" ? undefined : source.ingestionToken, hasProviderSecret: !!encryptedProviderSecret, hasVerificationToken: !!verificationTokenHash, providerDisplayName: providers[source.provider].displayName })));
  } catch (error) { return apiError(error); }
}
export async function POST(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const app = await ownApplication((await params).id, "manage");
    if (app.customerMode === "ISOLATED") return Response.json({ error: "Inbound sources require a legacy application" }, { status: 409 });
    const input = inputSchema.parse(await boundedJson(req, 4096));
    const source = await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
      if (await tx.webhookSource.count({ where: { applicationId: app.id } }) >= 50) throw new Error("Source limit reached");
      return tx.webhookSource.create({ data: { applicationId: app.id, name: input.name, provider: input.provider, ingestionToken: randomBytes(32).toString("hex") } });
    });
    return Response.json({ id: source.id, ingestionUrl: `${new URL(process.env.NEXTAUTH_URL || req.url).origin}/api/inbound/${source.ingestionToken}` }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
