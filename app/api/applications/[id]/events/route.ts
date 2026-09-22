import { eventBacklog } from "@/lib/event-backlog";
import { boundedJson } from "@/lib/input-limits";
import { ownApplication, apiError, sameOrigin } from "@/lib/access";
import { eventInput, ingest } from "@/lib/events";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    await ownApplication((await params).id);
    const input = eventInput.parse(await boundedJson(req));
    return Response.json(
      await ingest((await params).id, input),
      { status: 202 },
    );
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const app = await ownApplication((await params).id); return Response.json(await eventBacklog(app.id, new URL(req.url)), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return apiError(e); }
}
