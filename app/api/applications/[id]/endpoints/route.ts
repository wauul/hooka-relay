import { newEndpointData, publicEndpoint } from "@/lib/endpoint-config";
import { workspaceTransaction } from "@/lib/workspaces";
import { z } from "zod";
import { db } from "@/lib/db";
import { ownApplication, apiError, sameOrigin, userId } from "@/lib/access";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ownApplication((await params).id);
    return Response.json(
      (await db.endpoint.findMany({ where: { applicationId: (await params).id, kind: { not: "INBOUND" } } })).map(publicEndpoint),
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const app = await ownApplication((await params).id, "manage");
    const input = z
      .object({
        url: z.string().url().max(2000).optional(),
        mode: z.enum(["succeed", "fail", "hang", "flaky"]).optional(),
        eventTypes: z
          .array(z.string().min(1).max(120))
          .min(1)
          .max(50)
          .default(["*"]),
      })
      .parse(await req.json());
    const url = input.mode
      ? `${process.env.NEXTAUTH_URL}/api/fake-receiver/${input.mode}`
      : input.url;
    if (!url) throw new Error("URL required");
    const data = await newEndpointData(app.id, url, input.eventTypes);
    return Response.json(
      await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => tx.endpoint.create({
        data,
        select: { id: true, applicationId: true, url: true, eventTypes: true, status: true },
      })),
      { status: 201 },
    );
  } catch (e) {
    return apiError(e);
  }
}
