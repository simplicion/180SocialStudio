import path from 'path';
import fs from 'fs';
import { AsyncLocalStorage } from 'async_hooks';

// Robust multi-path environment loader so Prisma always finds DATABASE_URL
// regardless of whether executed from workspace root, app folder, or PM2 daemon
try {
  const dotenv = require('dotenv');
  const candidateEnvPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/180-social-studio-backend/.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(__dirname, '../../../apps/180-social-studio-backend/.env'),
  ];
  for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) {
        break;
      }
    }
  }
} catch (_) {}

// If DATABASE_URL is not provided or empty, supply a safe fallback URL
// to prevent PrismaClient from crashing during initialization
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim().length === 0) {
  process.env.DATABASE_URL = 'postgresql://pitchin_admin:dummy_local_pass@localhost:5432/180socialstudio_db?sslmode=disable';
}

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
    datasources: process.env.DATABASE_URL
      ? { db: { url: process.env.DATABASE_URL } }
      : undefined,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.socialStudioPrisma = prisma;
}

export function getCompanyPrisma(companyId?: string): PrismaClient {
  return prisma;
}

export default prisma;

