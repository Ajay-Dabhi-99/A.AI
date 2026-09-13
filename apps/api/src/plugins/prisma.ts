import type { ServerEnv } from '@a-ai/config/server';
import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '../generated/prisma/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Supabase PostgreSQL through Prisma's pg driver adapter. DATABASE_URL is the
 * pooled (Supavisor) connection; the client connects lazily on first query so
 * a database outage degrades /ready instead of preventing boot.
 */
export function createPrismaClient(env: ServerEnv): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    max: 10,
  });
  return new PrismaClient({ adapter });
}

export function registerPrisma(app: FastifyInstance, client: PrismaClient): void {
  app.decorate('prisma', client);
  app.addHook('onClose', async () => {
    await client.$disconnect();
  });
}
