import { inject } from "vitest";
const url = inject("databaseUrl");
if (!url || new URL(url).pathname !== "/hooka_relay_test") {
  throw new Error("Integration tests require their disposable Testcontainers database.");
}
// Runs before route imports initialize the real Prisma client in this worker.
process.env.DATABASE_URL = url;
delete (globalThis as { prisma?: unknown }).prisma;

declare module "vitest" {
  export interface ProvidedContext { databaseUrl: string }
}
