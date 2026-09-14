import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDb.prisma ?? new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:3})});
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
