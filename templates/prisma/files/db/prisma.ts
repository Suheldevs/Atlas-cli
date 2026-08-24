import { PrismaClient } from '@prisma/client';

/**
 * A dev server re-evaluates this module on every reload, and a fresh PrismaClient each time opens
 * a fresh connection pool until the database starts refusing connections. Keeping the client on
 * globalThis means a reload finds the one that already exists. Production only ever loads the
 * module once, so it gets a plain instance.
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** Close the pool on shutdown — SIGTERM, or after a test run, so the process can exit. */
export function disconnect(): Promise<void> {
  return prisma.$disconnect();
}
