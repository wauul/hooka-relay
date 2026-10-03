import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { traced } from "./observability";
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
function createDb() {
  return (
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl(),
      max: 3,
    }),
  })).$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
    // Only the generated model/operation name is recorded. Never SQL/arguments.
    return traced(`db.${model}.${operation}`, {}, () => query(args), undefined, false);
  } } } }) as unknown as PrismaClient;
  // The extension adds query telemetry only; Prisma's generated base contract
  // remains the public type, including existing TransactionClient callbacks.
}
const globalDb = globalThis as unknown as { prisma?: ReturnType<typeof createDb> };
export const db = globalDb.prisma ?? createDb();
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
