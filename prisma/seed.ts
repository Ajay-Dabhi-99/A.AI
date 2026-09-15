/**
 * Database seed, run with `pnpm db:seed`. Idempotent: inserts catalog models
 * that are missing from the registry and never overwrites admin changes.
 * The API also does this on first load, so seeding is optional.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { catalogModels, registryDefaults } from '../apps/api/src/providers/model-directory.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const { count } = await prisma.modelRegistryEntry.createMany({
    data: registryDefaults(catalogModels()),
    skipDuplicates: true,
  });
  const total = await prisma.modelRegistryEntry.count();
  console.log(`Model registry: ${count} added, ${total} total.`);
} finally {
  await prisma.$disconnect();
}
