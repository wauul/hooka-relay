import type { Prisma } from "@prisma/client";
import { db } from "../lib/db";
import { hashApiKey } from "../lib/secrets";
export async function createApplication(args: { data: Prisma.ApplicationUncheckedCreateInput }) {
  const plaintext = args.data.currentApiKey;
  const app = await db.application.create({ data: { ...args.data, currentApiKey: hashApiKey(plaintext) } });
  return { ...app, currentApiKey: plaintext };
}
