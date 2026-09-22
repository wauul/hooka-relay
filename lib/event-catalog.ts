import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { compileEventSchema } from "./event-schemas";
export const catalogInput = z.object({ eventType: z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/), description: z.string().max(2000), schema: z.unknown().optional() });
export async function publishEventType(tx: Prisma.TransactionClient, applicationId: string, input: z.infer<typeof catalogInput>) {
  const data = catalogInput.parse(input);
  if (data.schema !== undefined && data.schema !== null) compileEventSchema(data.schema);
  await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${applicationId} FOR UPDATE`;
  const latest = await tx.eventTypeVersion.findFirst({ where: { applicationId, eventType: data.eventType }, orderBy: { version: "desc" } });
  if (!latest && (await tx.eventTypeVersion.groupBy({ by: ["eventType"], where: { applicationId } })).length >= 50) throw new Error("Catalog limit reached");
  if (data.schema !== undefined && data.schema !== null && await tx.eventSchema.count({ where: { applicationId } }) >= 50 && !await tx.eventSchema.findUnique({ where: { applicationId_eventType: { applicationId, eventType: data.eventType } } })) throw new Error("Application schema limit reached");
  const schema = data.schema === undefined || data.schema === null ? Prisma.DbNull : data.schema as Prisma.InputJsonValue;
  const version = await tx.eventTypeVersion.create({ data: { applicationId, eventType: data.eventType, description: data.description, schema, version: (latest?.version || 0) + 1 } });
  const where = { applicationId_eventType: { applicationId, eventType: data.eventType } };
  if (data.schema === undefined || data.schema === null) await tx.eventSchema.deleteMany({ where: { applicationId, eventType: data.eventType } });
  else await tx.eventSchema.upsert({ where, create: { applicationId, eventType: data.eventType, schema: data.schema as Prisma.InputJsonValue }, update: { schema: data.schema as Prisma.InputJsonValue } });
  return version;
}
export function listEventTypes(applicationId: string) { return db.eventTypeVersion.findMany({ where: { applicationId }, orderBy: [{ eventType: "asc" }, { version: "desc" }], take: 500 }); }
