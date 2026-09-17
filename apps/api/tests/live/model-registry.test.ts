import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/plugins/prisma.js';
import {
  createPrismaModelRegistryRepository,
  type ModelRegistryDefault,
  type ModelRegistryRepository,
} from '../../src/repositories/model-registry.repository.js';
import { createPrismaRepositories } from '../../src/repositories/prisma.repositories.js';
import { testEnv } from '../helpers/test-app.js';

/** Phase 3 data gate against real Supabase PostgreSQL. */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Live model registry tests need TEST_DATABASE_URL (Supabase test project).');
}

let prisma: PrismaClient;
let registry: ModelRegistryRepository;
const provider = `live-${randomUUID().slice(0, 8)}`;
const emails: string[] = [];

function entry(
  modelId: string,
  overrides: Partial<ModelRegistryDefault> = {},
): ModelRegistryDefault {
  return {
    provider,
    modelId,
    name: modelId,
    category: 'text',
    contextWindow: 32_000,
    maxOutputTokens: 4_000,
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: false,
    availability: 'paid',
    enabled: true,
    sortOrder: 900,
    inputPricePerMillionUsd: 0.123456,
    outputPricePerMillionUsd: null,
    verifiedAt: null,
    ...overrides,
  };
}

beforeAll(() => {
  prisma = createPrismaClient(testEnv({ DATABASE_URL: databaseUrl }));
  registry = createPrismaModelRegistryRepository(prisma);
});

afterAll(async () => {
  if (prisma) {
    await prisma.modelRegistryEntry.deleteMany({ where: { provider } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  }
});

describe('registry migration', () => {
  it('created model_registry with RLS and added the role column', async () => {
    const [table] = await prisma.$queryRaw<{ relrowsecurity: boolean }[]>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'model_registry' AND relkind = 'r'
      AND relnamespace = 'public'::regnamespace`;
    expect(table?.relrowsecurity).toBe(true);

    const email = `live-role-${randomUUID()}@example.test`;
    emails.push(email);
    const users = createPrismaRepositories(prisma).users;
    expect((await users.create({ email, passwordHash: 'hash' })).role).toBe('USER');
    expect((await users.setRoleByEmail(email, 'ADMIN'))?.role).toBe('ADMIN');
    expect(await users.setRoleByEmail(`missing-${randomUUID()}@example.test`, 'ADMIN')).toBeNull();
  });
});

describe('Prisma model registry repository', () => {
  it('inserts missing defaults idempotently and never overwrites existing rows', async () => {
    expect(await registry.insertMissing([entry('a'), entry('b')])).toBe(2);
    const a = (await registry.list()).find(
      (row) => row.provider === provider && row.modelId === 'a',
    )!;
    await registry.update(a.id, { name: 'Edited' });

    expect(await registry.insertMissing([entry('a', { name: 'Default again' }), entry('b')])).toBe(
      0,
    );
    const again = (await registry.list()).find((row) => row.id === a.id);
    expect(again?.name).toBe('Edited');
  });

  it('round-trips decimal prices and returns null for unknown ids', async () => {
    await registry.insertMissing([entry('priced')]);
    const priced = (await registry.list()).find(
      (row) => row.provider === provider && row.modelId === 'priced',
    )!;
    expect(priced.inputPricePerMillionUsd).toBe(0.123456);
    expect(priced.outputPricePerMillionUsd).toBeNull();

    const updated = await registry.update(priced.id, {
      outputPricePerMillionUsd: 2.5,
      enabled: false,
    });
    expect(updated).toMatchObject({ outputPricePerMillionUsd: 2.5, enabled: false });
    expect(await registry.update(randomUUID(), { enabled: true })).toBeNull();
  });
});
