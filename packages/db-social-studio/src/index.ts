import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient, Prisma } from '../generated/client';

export { PrismaClient, Prisma };

export const requestContext = new AsyncLocalStorage<{ companyId?: string, userId?: string, [key: string]: any }>();

export const SAFE_QUERY_LIMIT = 100;
export const MAX_ALLOWED_TAKE = 500;

const globalForPrisma = globalThis as unknown as {
  socialStudioPrisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.socialStudioPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.socialStudioPrisma = prisma;
}

export function getCompanyPrisma(companyId?: string): PrismaClient {
  return prisma;
}

export default prisma;
