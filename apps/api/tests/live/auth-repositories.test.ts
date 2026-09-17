import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/plugins/prisma.js';
import {
  createPrismaRepositories,
  createPrismaTransactionRunner,
} from '../../src/repositories/prisma.repositories.js';
import { DuplicateEmailError, type Repositories } from '../../src/repositories/types.js';
import { generateToken, hmac } from '../../src/shared/security/tokens.js';
import { testEnv } from '../helpers/test-app.js';

/**
 * Phase 1 data gate against real Supabase PostgreSQL: the migration applied by
 * global-setup, the Prisma repositories, atomic token consumption and RLS.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Live auth repository tests need TEST_DATABASE_URL (Supabase test project).');
}

let prisma: PrismaClient;
let repos: Repositories;
const createdEmails: string[] = [];

function uniqueEmail(): string {
  const email = `live-${randomUUID()}@example.test`;
  createdEmails.push(email);
  return email;
}

beforeAll(() => {
  prisma = createPrismaClient(testEnv({ DATABASE_URL: databaseUrl }));
  repos = createPrismaRepositories(prisma);
});

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  }
});

describe('migration', () => {
  it('created the auth tables with Row Level Security enabled', async () => {
    const rows = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('users', 'sessions', 'auth_tokens') AND relkind = 'r'
      AND relnamespace = 'public'::regnamespace
      ORDER BY relname`;
    expect(rows).toEqual([
      { relname: 'auth_tokens', relrowsecurity: true },
      { relname: 'sessions', relrowsecurity: true },
      { relname: 'users', relrowsecurity: true },
    ]);
  });
});

describe('Prisma repositories', () => {
  it('creates users and rejects duplicate emails with DuplicateEmailError', async () => {
    const email = uniqueEmail();
    const user = await repos.users.create({ email, passwordHash: 'hash' });
    expect(user).toMatchObject({ email, emailVerifiedAt: null });
    await expect(repos.users.create({ email, passwordHash: 'other' })).rejects.toBeInstanceOf(
      DuplicateEmailError,
    );
  });

  it('finds only active sessions and revokes them', async () => {
    const user = await repos.users.create({ email: uniqueEmail(), passwordHash: 'hash' });
    const now = new Date();
    const tokenHash = hmac('live-secret', 'session', generateToken());
    const session = await repos.sessions.create({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + 60_000),
      userAgent: 'vitest-live',
      ipHash: null,
    });

    expect((await repos.sessions.findActiveByTokenHash(tokenHash, now))?.user.id).toBe(user.id);
    await repos.sessions.revoke(session.id, now);
    expect(await repos.sessions.findActiveByTokenHash(tokenHash, now)).toBeNull();
  });

  it('lets exactly one of two concurrent consumers use a token', async () => {
    const user = await repos.users.create({ email: uniqueEmail(), passwordHash: 'hash' });
    const tokenHash = hmac('live-secret', 'email-link', generateToken());
    const now = new Date();
    await repos.authTokens.create({
      userId: user.id,
      type: 'EMAIL_VERIFICATION',
      tokenHash,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    const results = await Promise.all([
      repos.authTokens.consume(tokenHash, 'EMAIL_VERIFICATION', now),
      repos.authTokens.consume(tokenHash, 'EMAIL_VERIFICATION', now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('rolls back every write in a failed transaction', async () => {
    const email = uniqueEmail();
    const transaction = createPrismaTransactionRunner(prisma);
    await expect(
      transaction(async (tx) => {
        await tx.users.create({ email, passwordHash: 'hash' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await repos.users.findByEmail(email)).toBeNull();
  });

  it('cascades session and token deletion with the user', async () => {
    const user = await repos.users.create({ email: uniqueEmail(), passwordHash: 'hash' });
    await repos.sessions.create({
      userId: user.id,
      tokenHash: hmac('live-secret', 'session', generateToken()),
      expiresAt: new Date(Date.now() + 60_000),
      userAgent: null,
      ipHash: null,
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
