import { randomUUID } from 'node:crypto';
import {
  DuplicateEmailError,
  type AuthTokenRecord,
  type Repositories,
  type SessionRecord,
  type TransactionRunner,
  type UserRecord,
} from '../../src/repositories/types.js';

export type MemoryRepositories = Repositories & {
  data: { users: UserRecord[]; sessions: SessionRecord[]; authTokens: AuthTokenRecord[] };
  transaction: TransactionRunner;
};

const copy = <T extends object>(value: T): T => ({ ...value });

/**
 * In-memory implementation of the repository contracts, used by unit and
 * integration tests. The Prisma implementation is exercised by the live suite.
 */
export function createMemoryRepositories(): MemoryRepositories {
  const data = {
    users: [] as UserRecord[],
    sessions: [] as SessionRecord[],
    authTokens: [] as AuthTokenRecord[],
  };

  const repositories: Repositories = {
    users: {
      findByEmail: async (email) => {
        const user = data.users.find((candidate) => candidate.email === email);
        return user ? copy(user) : null;
      },
      findById: async (id) => {
        const user = data.users.find((candidate) => candidate.id === id);
        return user ? copy(user) : null;
      },
      create: async ({ email, passwordHash }) => {
        if (data.users.some((user) => user.email === email)) throw new DuplicateEmailError();
        const now = new Date();
        const user: UserRecord = {
          id: randomUUID(),
          email,
          passwordHash,
          emailVerifiedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        data.users.push(user);
        return copy(user);
      },
      updatePasswordHash: async (id, passwordHash) => {
        const user = data.users.find((candidate) => candidate.id === id);
        if (user) user.passwordHash = passwordHash;
      },
      markEmailVerified: async (id, at) => {
        const user = data.users.find((candidate) => candidate.id === id);
        if (!user) throw new Error(`user ${id} not found`);
        user.emailVerifiedAt ??= at;
        return copy(user);
      },
    },

    sessions: {
      create: async (input) => {
        const session: SessionRecord = {
          id: randomUUID(),
          ...input,
          lastSeenAt: new Date(input.expiresAt.getTime() - 30 * 24 * 60 * 60 * 1000),
          revokedAt: null,
          createdAt: new Date(),
        };
        data.sessions.push(session);
        return copy(session);
      },
      findActiveByTokenHash: async (tokenHash, now) => {
        const session = data.sessions.find(
          (candidate) =>
            candidate.tokenHash === tokenHash &&
            candidate.revokedAt === null &&
            candidate.expiresAt.getTime() > now.getTime(),
        );
        if (!session) return null;
        const user = data.users.find((candidate) => candidate.id === session.userId);
        return user ? { ...copy(session), user: copy(user) } : null;
      },
      touch: async (id, lastSeenAt, expiresAt) => {
        const session = data.sessions.find((candidate) => candidate.id === id);
        if (session) Object.assign(session, { lastSeenAt, expiresAt });
      },
      revoke: async (id, at) => {
        const session = data.sessions.find((candidate) => candidate.id === id);
        if (session && session.revokedAt === null) session.revokedAt = at;
      },
      revokeAllForUser: async (userId, at) => {
        for (const session of data.sessions) {
          if (session.userId === userId && session.revokedAt === null) session.revokedAt = at;
        }
      },
    },

    authTokens: {
      create: async (input) => {
        const token: AuthTokenRecord = {
          id: randomUUID(),
          ...input,
          usedAt: null,
          createdAt: new Date(),
        };
        data.authTokens.push(token);
        return copy(token);
      },
      consume: async (tokenHash, type, now) => {
        const token = data.authTokens.find(
          (candidate) =>
            candidate.tokenHash === tokenHash &&
            candidate.type === type &&
            candidate.usedAt === null &&
            candidate.expiresAt.getTime() > now.getTime(),
        );
        if (!token) return null;
        token.usedAt = now;
        return copy(token);
      },
      invalidateAll: async (userId, type, now) => {
        for (const token of data.authTokens) {
          if (token.userId === userId && token.type === type && token.usedAt === null) {
            token.usedAt = now;
          }
        }
      },
    },
  };

  return { ...repositories, data, transaction: (work) => work(repositories) };
}
