import { ownApplication, apiError, sameOrigin } from "@/lib/access";
import { eventInput, ingest } from "@/lib/events";
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    sameOrigin(req);
    await ownApplication(params.id);
    const text = await req.text();
    if (Buffer.byteLength(text) > 262144) throw new Error("Too large");
    return Response.json(
      await ingest(params.id, eventInput.parse(JSON.parse(text))),
      { status: 202 },
    );
  } catch (e) {
    return apiError(e);
  }
}
