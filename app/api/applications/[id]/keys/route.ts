import { db } from "@/lib/db";
import { ownApplication, userId, sameOrigin, apiError } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { workspaceTransaction } from "@/lib/workspaces";
type Context = { params: Promise<{ id: string }> };
import { z } from "zod";
import { newSecret } from "@/lib/security";
import { hashApiKey } from "@/lib/secrets";
const fields = { id: true, name: true, scope: true, expiresAt: true, lastUsedAt: true, createdAt: true } as const;
export async function GET(_req: Request, { params }: Context) { try { const app = await ownApplication((await params).id, "manage"); return Response.json(await db.applicationKey.findMany({ where: { applicationId: app.id }, select: fields }), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return apiError(e); } }
export async function POST(req: Request, { params }: Context) { try { sameOrigin(req); const app = await ownApplication((await params).id, "manage"); const input = z.object({ name: z.string().trim().min(1).max(100), scope: z.enum(["READ_ONLY", "INGEST_ONLY"]), expiresAt: z.string().datetime().optional() }).parse(await boundedJson(req, 2048));
  if (input.expiresAt && new Date(input.expiresAt) <= new Date()) throw new Error("Expiry must be in the future");
  const plaintext = "hr_scoped_" + newSecret();
  const key = await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
    await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${app.id} FOR UPDATE`;
    if (await tx.applicationKey.count({ where: { applicationId: app.id } }) >= 20) throw new Error("At most 20 scoped keys per application");
    return tx.applicationKey.create({ data: { ...input, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, applicationId: app.id, hash: hashApiKey(plaintext) }, select: fields });
  }); return Response.json({ ...key, key: plaintext }, { status: 201, headers: { "Cache-Control": "no-store" } });
} catch (e) { return apiError(e); } }
export async function DELETE(req: Request, { params }: Context) { try { sameOrigin(req); const app = await ownApplication((await params).id, "manage"); const { id } = z.object({ id: z.string().min(1) }).parse(await boundedJson(req, 1024)); await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => tx.applicationKey.deleteMany({ where: { id, applicationId: app.id } })); return Response.json({ ok: true }); } catch (e) { return apiError(e); } }
