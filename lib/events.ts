import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { publish } from "./queue/client";
export const eventInput = z.object({
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
  const d = await db.delivery.findUnique({ where: { id } });
  if (!d || d.status !== "PENDING" || d.publishedAt) return;
  await publish({ id: d.id, attemptNumber: d.attemptNumber }, d.delayQueue);
  await db.delivery.updateMany({
    where: { id, attemptNumber: d.attemptNumber, status: "PENDING" },
    data: { publishedAt: new Date() },
  });
}
export async function ingest(
  applicationId: string,
  input: z.infer<typeof eventInput>,
) {
  // Application-scoped uniqueness handles simultaneous producer retries. A
  // duplicate returns the original event even if the new body is different.
  const idempotencyKey = input.idempotencyKey || randomUUID();
  try {
    const event = await db.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          applicationId,
          idempotencyKey,
          type: input.type,
          payload:
            input.payload === null
              ? Prisma.JsonNull
              : (input.payload as Prisma.InputJsonValue),
        },
      });
      const endpoints = await tx.endpoint.findMany({
        where: {
          applicationId,
          status: "ACTIVE",
          OR: [
            { eventTypes: { has: "*" } },
            { eventTypes: { has: input.type } },
          ],
        },
        select: { id: true },
      });
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
    return event;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return db.event.findUniqueOrThrow({
        where: {
          applicationId_idempotencyKey: { applicationId, idempotencyKey },
        },
      });
    throw e;
  }
}
