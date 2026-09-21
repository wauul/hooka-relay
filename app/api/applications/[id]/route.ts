import { db } from "@/lib/db";
import { ownApplication, apiError, sameOrigin, userId } from "@/lib/access";
import { rotateKey, keyGraceHours } from "@/lib/api-keys";
import { workspaceTransaction } from "@/lib/workspaces";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  try {
    const app = await ownApplication((await params).id);
    const { currentApiKey: _current, previousApiKey: _previous, ...safe } = app;
    const endpoints = await db.endpoint.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" } });
    return Response.json({ ...safe, keyGraceHours: keyGraceHours(), endpoints: endpoints.map(({ secret: _secret, ...ep }) => ep) });
  } catch (e) { return apiError(e); }
}
export async function POST(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const app = await ownApplication((await params).id, "manage");
    const rotated = await rotateKey(app.id, await userId());
    return Response.json({ currentApiKey: rotated.currentApiKey, previousApiKeyExpiresAt: rotated.previousApiKeyExpiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiError(e); }
}
export async function DELETE(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const app = await ownApplication((await params).id, "manage");
    await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => tx.application.delete({ where: { id: app.id } }));
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
