import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
async function handler(req: Request, { params }: { params: { mode: string } }) {
  const { mode } = params;
  if (mode === "succeed") return Response.json({ ok: true });
  if (mode === "fail")
    return Response.json(
      { error: "Demo receiver unavailable" },
      { status: 500 },
    );
  if (mode === "hang") {
    await new Promise((r) => setTimeout(r, 14000));
    return Response.json(
      { error: "Receiver exceeded the 10-second delivery deadline" },
      { status: 504 },
    );
  }
  if (mode === "flaky") {
    const eventKey = req.headers.get("x-idempotency-key");
    const endpointId = req.headers.get("x-webhook-endpoint");
    if (!eventKey || !endpointId)
      return Response.json(
        { error: "Send through Hooka Relay to demonstrate per-event retries" },
        { status: 400 },
      );
    const receipt = await db.fakeReceipt.upsert({
      where: { key: `${endpointId}:${eventKey}` },
      create: { key: `${endpointId}:${eventKey}`, calls: 1 },
      update: { calls: { increment: 1 } },
    });
    return Response.json(
      { ok: receipt.calls > 2, call: receipt.calls },
      { status: receipt.calls > 2 ? 200 : 500 },
    );
  }
  return Response.json({ error: "Unknown mode" }, { status: 404 });
}
export { handler as GET, handler as POST };
