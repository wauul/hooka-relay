import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, ownApplication, sameOrigin, userId } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { workspaceTransaction } from "@/lib/workspaces";
import { newEndpointData } from "@/lib/endpoint-config";

const destinationSchema = z.object({ id: z.string().optional(), url: z.string().url().max(2000), retryPolicy: z.enum(["STANDARD", "AGGRESSIVE", "RELAXED"]), status: z.enum(["ACTIVE", "PAUSED"]) });
const groupSchema = z.object({ triggerCondition: z.enum(["ALWAYS", "ON_PREVIOUS_SUCCESS", "ON_PREVIOUS_FAILURE"]), successPolicy: z.enum(["ALL_MUST_SUCCEED", "ANY_MUST_SUCCEED"]), destinations: z.array(destinationSchema).min(1).max(8) });
const schema = z.object({ groups: z.array(groupSchema).min(1).max(8) });
type Context = { params: Promise<{ id: string }> };

async function sourceFor(id: string, action: "view" | "manage" = "view") {
  const source = await db.webhookSource.findUnique({ where: { id } });
  if (!source) throw new Error("NOT_FOUND");
  const app = await ownApplication(source.applicationId, action);
  return { source, app };
}
export async function GET(_req: Request, { params }: Context) {
  try {
    const { source, app } = await sourceFor((await params).id);
    const groups = await db.destinationGroup.findMany({ where: { webhookSourceId: source.id }, orderBy: { order: "asc" }, include: { destinations: { include: { endpoint: { select: { url: true, retryPolicy: true, status: true, circuitState: true } } } } } });
    return Response.json({ canManage: app.role !== "MEMBER", groups: groups.map(group => ({ id: group.id, triggerCondition: group.triggerCondition, successPolicy: group.successPolicy, destinations: group.destinations.map(destination => ({ id: destination.id, url: destination.endpoint.url, retryPolicy: destination.endpoint.retryPolicy, status: destination.endpoint.status, circuitState: destination.endpoint.circuitState })) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
export async function PUT(req: Request, { params }: Context) {
  try {
    sameOrigin(req);
    const { source, app } = await sourceFor((await params).id, "manage");
    const input = schema.parse(await boundedJson(req, 65536));
    if (input.groups[0].triggerCondition !== "ALWAYS") throw new Error("The first group must always run");
    const ids = input.groups.flatMap(group => group.destinations.map(destination => destination.id).filter((id): id is string => !!id));
    if (new Set(ids).size !== ids.length) throw new Error("A destination can only appear once");
    // Prepare secrets and DNS checks before the transaction; no network work is
    // performed while source and workspace rows are locked.
    async function prepare(url: string) { return await newEndpointData(app.id, url, ["*"]); }
    const prepared = await Promise.all(input.groups.map(async group => Promise.all(group.destinations.map(destination => prepare(destination.url)))));
    await workspaceTransaction(app.workspaceId, await userId(), "manage", async tx => {
      await tx.$queryRaw`SELECT id FROM "WebhookSource" WHERE id = ${source.id} FOR UPDATE`;
      if (await tx.routingExecution.count({ where: { webhookSourceId: source.id, status: "RUNNING" } })) throw new Error("Wait for in-progress routes to finish before editing destinations");
      const old = await tx.destinationGroup.findMany({ where: { webhookSourceId: source.id }, include: { destinations: true } });
      const existing = new Map(old.flatMap(group => group.destinations.map(destination => [destination.id, destination.endpointId] as const)));
      if (ids.some(id => !existing.has(id))) throw new Error("Unknown destination");
      await tx.destinationGroup.deleteMany({ where: { webhookSourceId: source.id } });
      let firstEndpointId: string | null = null;
      for (let order = 0; order < input.groups.length; order++) {
        const groupInput = input.groups[order];
        const group = await tx.destinationGroup.create({ data: { webhookSourceId: source.id, order, triggerCondition: groupInput.triggerCondition, successPolicy: groupInput.successPolicy } });
        for (let index = 0; index < groupInput.destinations.length; index++) {
          const destination = groupInput.destinations[index];
          const endpointId = destination.id ? existing.get(destination.id)! : (await tx.endpoint.create({ data: { ...prepared[order][index], kind: "INBOUND", retryPolicy: destination.retryPolicy, status: destination.status } })).id;
          if (destination.id) await tx.endpoint.update({ where: { id: endpointId }, data: { url: destination.url, retryPolicy: destination.retryPolicy, status: destination.status } });
          await tx.routingDestination.create({ data: { destinationGroupId: group.id, endpointId } });
          firstEndpointId ??= endpointId;
        }
      }
      await tx.webhookSource.update({ where: { id: source.id }, data: { endpointId: firstEndpointId, destinationUrl: input.groups[0].destinations[0].url } });
    });
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
