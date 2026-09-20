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
