import { ownApplication, userId, sameOrigin, apiError } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { workspaceTransaction } from "@/lib/workspaces";
type Context = { params: Promise<{ id: string }> };
import { catalogInput, listEventTypes, publishEventType } from "@/lib/event-catalog";
export async function GET(_req: Request, { params }: Context) { try { const app = await ownApplication((await params).id); return Response.json(await listEventTypes(app.id)); } catch (e) { return apiError(e); } }
export async function POST(req: Request, { params }: Context) { try { sameOrigin(req); const app = await ownApplication((await params).id, "manage"); const input = catalogInput.parse(await boundedJson(req, 20000)); return Response.json(await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => publishEventType(tx, app.id, input)), { status: 201 }); } catch (e) { return apiError(e); } }
