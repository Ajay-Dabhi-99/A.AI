/**
 * Database seed entry point, run with `pnpm db:seed`.
 *
 * Phase 0 has no tables, so the seed only proves the database is reachable.
 * The model registry seed (MODEL-013) is added here in Phase 3.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log('Seed complete: database reachable, nothing to seed in Phase 0.');
} finally {
  await prisma.$disconnect();
}
