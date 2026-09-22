import { db } from "@/lib/db";
import { ownApplication, sameOrigin, apiError } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
type Context = { params: Promise<{ id: string }> };
import { z } from "zod";
import { startRecovery } from "@/lib/recovery";
export async function GET(_req: Request, { params }: Context) { try { const app = await ownApplication((await params).id); return Response.json(await db.recoveryJob.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" }, take: 20 })); } catch (e) { return apiError(e); } }
export async function POST(req: Request, { params }: Context) { try { sameOrigin(req); const app = await ownApplication((await params).id, "manage"); const input = z.object({ since: z.string().datetime(), endpointId: z.string().min(1).optional() }).parse(await boundedJson(req, 1024)); return Response.json(await startRecovery(app.id, new Date(input.since), input.endpointId), { status: 202 }); } catch (e) { return apiError(e); } }
