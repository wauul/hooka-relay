import { hashApiKey } from "@/lib/secrets";
import { db } from "@/lib/db";
import { z } from "zod";
import { userId, apiError, sameOrigin } from "@/lib/access";
import { newSecret } from "@/lib/security";
import { defaultWorkspace, membership, workspaceTransaction } from "@/lib/workspaces";
export async function GET(req: Request) {
  try {
    const uid = await userId();
    const workspaceId = new URL(req.url).searchParams.get("workspaceId") || req.headers.get("x-workspace-id") || await defaultWorkspace(uid);
    await membership(workspaceId, uid);
    return Response.json(await db.application.findMany({ where: { workspaceId }, select: { id: true, name: true, workspaceId: true, createdAt: true, _count: { select: { endpoints: { where: { kind: { not: "INBOUND" } } }, events: true } } }, orderBy: { createdAt: "desc" } }));
  } catch (e) { return apiError(e); }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const uid = await userId();
    const input = z.object({ name: z.string().trim().min(1).max(80), workspaceId: z.string().min(1).optional(), customerMode: z.enum(["LEGACY", "ISOLATED"]).default("LEGACY") }).parse(await req.json());
    const workspaceId = input.workspaceId || req.headers.get("x-workspace-id") || await defaultWorkspace(uid);
    const plaintext = "hr_live_" + newSecret();
    const app = await workspaceTransaction(workspaceId, uid, "manage", tx => tx.application.create({ data: { name: input.name, workspaceId, customerMode: input.customerMode, currentApiKey: hashApiKey(plaintext) } }));
    return Response.json({ ...app, currentApiKey: plaintext }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiError(e); }
}
