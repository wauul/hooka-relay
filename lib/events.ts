import { validateEventPayload } from "./event-schemas";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { publish } from "./queue/client";
import { traced, traceparent, count } from "./observability";
import { WorkspaceError } from "./workspaces";
import { createRoutingExecution } from "./routing";
import { validateCustomer } from "./customer-scope";
export const eventInput = z.object({
  customerId: z.string().min(1).max(100).optional(),
  type: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_.:-]+$/),
  payload: z.unknown().refine((v) => v !== undefined, "payload required"),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[\x21-\x7e]+$/)
    .optional(),
});
export async function flushDelivery(id: string) {
  const d = await db.delivery.findUnique({ where: { id }, include: { event: { select: { traceparent: true } } } });
  if (!d || d.status !== "PENDING" || d.publishedAt || (!d.delayQueue && d.dueAt > new Date())) return;
  await traced("outbox.enqueue", { "hooka.delivery.id": d.id, "hooka.attempt": d.attemptNumber }, () => publish({ id: d.id, attemptNumber: d.attemptNumber }, d.delayQueue), d.event?.traceparent ?? null);
  await db.delivery.updateMany({
    where: { id, attemptNumber: d.attemptNumber, status: "PENDING" },
    data: { publishedAt: new Date() },
  });
}
export async function ingest(
  applicationId: string,
  input: z.infer<typeof eventInput>,
  target?: { endpointId?: string; webhookSourceId?: string },
) {
  return traced("event.ingest", {}, async span => {
  // Application-scoped uniqueness handles simultaneous producer retries. A
  // duplicate returns the original event even if the new body is different.
  const idempotencyKey = input.idempotencyKey || randomUUID();
  let accepted = false;
  let expectedCustomerId: string | null = null;
  try {
    const event = await db.$transaction(async (tx) => {
      // Serialize schema changes/admission and check duplicates first so a new
      // schema cannot reject an event already accepted under its original key.
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
      const targetEndpoint = target?.endpointId ? await tx.endpoint.findFirst({ where: { id: target.endpointId, applicationId }, select: { customerId: true } }) : null;
      if (target?.endpointId && !targetEndpoint) throw new WorkspaceError(404, "Endpoint not found");
      const customerId = await validateCustomer(tx, applicationId, targetEndpoint ? targetEndpoint.customerId || undefined : input.customerId);
      expectedCustomerId = customerId;
      if (target?.webhookSourceId && customerId) throw new WorkspaceError(409, "Inbound sources are not available in customer-isolated applications");
      const existing = await tx.event.findUnique({ where: { applicationId_idempotencyKey: { applicationId, idempotencyKey } } });
      if (existing) {
        if (existing.customerId !== customerId) throw new WorkspaceError(409, "Idempotency key already used");
        return existing;
      }
      const registered = await tx.eventSchema.findUnique({ where: { applicationId_eventType: { applicationId, eventType: input.type } } });
      if (registered) validateEventPayload(registered.schema, input.payload);
      const event = await tx.event.create({
        data: {
          applicationId,
          customerId,
          billable: !target || Boolean(target.webhookSourceId),
          ...(target?.webhookSourceId ? { webhookSourceId: target.webhookSourceId } : {}),
          idempotencyKey,
          type: input.type,
          traceparent: traceparent(),
          payload:
            input.payload === null
              ? Prisma.JsonNull
              : (input.payload as Prisma.InputJsonValue),
        },
      });
      accepted = true;
      if (target?.webhookSourceId && await createRoutingExecution(tx, event.id, target.webhookSourceId)) return event;
      const endpoints = target?.webhookSourceId && !target.endpointId ? [] : await tx.endpoint.findMany({
        where: {
          applicationId,
          customerId,
          status: "ACTIVE",
          ...(target ? { id: target.endpointId, ...(target.webhookSourceId ? { kind: "INBOUND" as const } : { circuitState: "CLOSED" as const }) } : { kind: "BUSINESS" as const, OR: [
            { eventTypes: { has: "*" } },
            { eventTypes: { has: input.type } },
          ] }),
        },
        select: { id: true },
      });
      if (target?.endpointId && endpoints.length !== 1) throw new WorkspaceError(409, "Endpoint is unavailable for a synthetic test.");
      await tx.delivery.createMany({
        data: endpoints.map((e) => ({ eventId: event.id, endpointId: e.id })),
      });
      return event;
    });
    // The transaction commits the event AND every delivery intent. The worker
    // drains this outbox if the API crashes or RabbitMQ is unavailable.
    const jobs = await db.delivery.findMany({
      where: { eventId: event.id },
      select: { id: true },
    });
    await Promise.allSettled(jobs.map((j) => flushDelivery(j.id)));
    if (accepted && !target?.endpointId) count("hooka.events.accepted");
    span.setAttribute("hooka.event.id", event.id);
    return event;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      {
      const existing = await db.event.findUniqueOrThrow({
        where: {
          applicationId_idempotencyKey: { applicationId, idempotencyKey },
        },
      });
      if (existing.customerId !== expectedCustomerId) throw new WorkspaceError(409, "Idempotency key already used");
      return existing;
      }
    throw e;
  }
  });
}
