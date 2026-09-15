import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { DuplicateEmailError, type Repositories, type TransactionRunner } from './types.js';

type Db = PrismaClient | Prisma.TransactionClient;

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

export function createPrismaRepositories(db: Db): Repositories {
  return {
    users: {
      findByEmail: (email) => db.user.findUnique({ where: { email } }),
      findById: (id) => db.user.findUnique({ where: { id } }),
      create: async (data) => {
        try {
          return await db.user.create({ data });
        } catch (error) {
          if (isUniqueViolation(error)) throw new DuplicateEmailError();
          throw error;
        }
      },
      setRoleByEmail: async (email, role) => {
        const { count } = await db.user.updateMany({ where: { email }, data: { role } });
        return count === 1 ? db.user.findUnique({ where: { email } }) : null;
      },
      updatePasswordHash: async (id, passwordHash) => {
        await db.user.update({ where: { id }, data: { passwordHash } });
      },
      markEmailVerified: async (id, at) => {
        await db.user.updateMany({
          where: { id, emailVerifiedAt: null },
          data: { emailVerifiedAt: at },
        });
        return db.user.findUniqueOrThrow({ where: { id } });
      },
    },

    sessions: {
      create: (data) => db.session.create({ data }),
      findActiveByTokenHash: (tokenHash, now) =>
        db.session.findFirst({
          where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
          include: { user: true },
        }),
      touch: async (id, lastSeenAt, expiresAt) => {
        await db.session.update({ where: { id }, data: { lastSeenAt, expiresAt } });
      },
      revoke: async (id, at) => {
        await db.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
      },
      revokeAllForUser: async (userId, at) => {
        await db.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: at },
        });
      },
    },

    authTokens: {
      create: (data) => db.authToken.create({ data }),
      consume: async (tokenHash, type, now) => {
        // The conditional update is the atomic step: only one caller can flip usedAt.
        const { count } = await db.authToken.updateMany({
          where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        return count === 1 ? db.authToken.findUnique({ where: { tokenHash } }) : null;
      },
      invalidateAll: async (userId, type, now) => {
        await db.authToken.updateMany({
          where: { userId, type, usedAt: null },
          data: { usedAt: now },
        });
      },
    },
  };
}

export function createPrismaTransactionRunner(prisma: PrismaClient): TransactionRunner {
  return (work) => prisma.$transaction((tx) => work(createPrismaRepositories(tx)));
}
