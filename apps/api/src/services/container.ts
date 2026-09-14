import { appUrl, type ServerEnv } from '@a-ai/config/server';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { ChatService } from '../modules/chat/chat.service.js';
import { GuestConversationStore } from '../modules/chat/guest-conversation.store.js';
import { GuestService } from '../modules/guest/guest.service.js';
import {
  ModelDirectory,
  providerEntriesFromEnv,
  type ProviderEntry,
} from '../providers/model-directory.js';
import {
  createPrismaConversationRepository,
  type ConversationRepository,
} from '../repositories/conversation.repository.js';
import {
  createPrismaRepositories,
  createPrismaTransactionRunner,
} from '../repositories/prisma.repositories.js';
import type { Repositories, TransactionRunner } from '../repositories/types.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { argon2PasswordHasher, type PasswordHasher } from '../shared/security/password.js';
import { createEmailSender, type EmailSender } from './email/email-sender.js';
import { createRedisStore, type KeyValueStore } from './kv-store.js';
import { QuotaService } from './quota.service.js';
import { RATE_LIMITS, RateLimiter, type RateLimitRules } from './rate-limit.service.js';

export type AppServices = {
  repositories: Repositories;
  transaction: TransactionRunner;
  conversations: ConversationRepository;
  store: KeyValueStore;
  rateLimiter: RateLimiter;
  rateLimits: RateLimitRules;
  quota: QuotaService;
  guests: GuestService;
  guestChats: GuestConversationStore;
  sessions: SessionService;
  auth: AuthService;
  directory: ModelDirectory;
  chat: ChatService;
  email: EmailSender;
  clock: Clock;
  /** JWT_SECRET: keys every HMAC (sessions, links, IPs, emails). */
  secret: string;
};

/**
 * Test seams. Production passes none and gets Prisma, Upstash, argon2, Resend
 * and adapters for every provider whose key is configured.
 */
export type ServiceOverrides = {
  repositories?: Repositories;
  transaction?: TransactionRunner;
  conversations?: ConversationRepository;
  providers?: ProviderEntry[];
  email?: EmailSender;
  hasher?: PasswordHasher;
  clock?: Clock;
  rateLimits?: Partial<RateLimitRules>;
};

export function createServices(input: {
  env: ServerEnv;
  prisma: PrismaClient;
  redis: Redis;
  logger: FastifyBaseLogger;
  overrides?: ServiceOverrides;
}): AppServices {
  const { env, prisma, redis, logger, overrides = {} } = input;

  const clock = overrides.clock ?? systemClock;
  const repositories = overrides.repositories ?? createPrismaRepositories(prisma);
  const passthrough: TransactionRunner = (work) => work(repositories);
  const transaction =
    overrides.transaction ??
    (overrides.repositories ? passthrough : createPrismaTransactionRunner(prisma));
  const conversations = overrides.conversations ?? createPrismaConversationRepository(prisma);

  const store = createRedisStore(redis);
  const email = overrides.email ?? createEmailSender(env, logger);
  const quota = new QuotaService(
    store,
    { guest: env.GUEST_DAILY_MESSAGE_LIMIT, user: env.USER_DAILY_MESSAGE_LIMIT },
    clock,
  );
  const guestChats = new GuestConversationStore(store, clock);
  const directory = new ModelDirectory(overrides.providers ?? providerEntriesFromEnv(env));
  const sessions = new SessionService({
    sessions: repositories.sessions,
    secret: env.JWT_SECRET,
    clock,
  });

  return {
    repositories,
    transaction,
    conversations,
    store,
    rateLimiter: new RateLimiter(store),
    rateLimits: { ...RATE_LIMITS, ...overrides.rateLimits },
    quota,
    guests: new GuestService(store, env.GUEST_SESSION_TTL_MINUTES, clock),
    guestChats,
    sessions,
    auth: new AuthService({
      repositories,
      transaction,
      hasher: overrides.hasher ?? argon2PasswordHasher,
      sessions,
      email,
      secret: env.JWT_SECRET,
      appUrl: appUrl(env),
      clock,
      logger,
    }),
    directory,
    chat: new ChatService({ directory, conversations, guestChats, quota, clock, logger }),
    email,
    clock,
    secret: env.JWT_SECRET,
  };
}
