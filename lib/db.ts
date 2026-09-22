import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
function databaseUrl() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return connectionString;
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode && ["prefer", "require", "verify-ca"].includes(sslMode)) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}
export const db =
  globalDb.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl(),
      max: 3,
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
