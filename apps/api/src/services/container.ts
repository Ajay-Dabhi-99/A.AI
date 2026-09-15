import type { ProviderRegistry } from '@a-ai/ai-core';
import { appUrl, type ServerEnv } from '@a-ai/config/server';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { RetryPolicy } from '../ai/retry-policy.js';
import { ModelSummarizer, type ConversationSummarizer } from '../ai/summarizer.js';
import { TokenService } from '../ai/token.service.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { ChatService } from '../modules/chat/chat.service.js';
import { GuestConversationStore } from '../modules/chat/guest-conversation.store.js';
import { ComparisonService } from '../modules/comparison/comparison.service.js';
import { GuestComparisonStore } from '../modules/comparison/guest-comparison.store.js';
import { GuestService } from '../modules/guest/guest.service.js';
import {
  catalogModels,
  createAdapterRegistry,
  DEFAULT_PROVIDER_NAMES,
  providerEntriesFromEnv,
  registryDefaults,
  type ProviderEntry,
} from '../providers/model-directory.js';
import { ModelRegistryService } from '../providers/model-registry.service.js';
import { ProviderHealthService } from '../providers/provider-health.service.js';
import {
  createPrismaComparisonRepository,
  type ComparisonRepository,
} from '../repositories/comparison.repository.js';
import {
  createPrismaConversationRepository,
  type ConversationRepository,
} from '../repositories/conversation.repository.js';
import {
  createPrismaModelRegistryRepository,
  type ModelRegistryRepository,
} from '../repositories/model-registry.repository.js';
import {
  createPrismaRepositories,
  createPrismaTransactionRunner,
} from '../repositories/prisma.repositories.js';
import type { Repositories, TransactionRunner } from '../repositories/types.js';
import { systemClock, type Clock } from '../shared/clock.js';
import { argon2PasswordHasher, type PasswordHasher } from '../shared/security/password.js';
import { ContextService } from './context.service.js';
import { createEmailSender, type EmailSender } from './email/email-sender.js';
import { createRedisStore, type KeyValueStore } from './kv-store.js';
import { QuotaService } from './quota.service.js';
import { RATE_LIMITS, RateLimiter, type RateLimitRules } from './rate-limit.service.js';

export type AppServices = {
  repositories: Repositories;
  transaction: TransactionRunner;
  conversations: ConversationRepository;
  comparisons: ComparisonRepository;
  store: KeyValueStore;
  rateLimiter: RateLimiter;
  rateLimits: RateLimitRules;
  quota: QuotaService;
  guests: GuestService;
  guestChats: GuestConversationStore;
  sessions: SessionService;
  auth: AuthService;
  /** Adapters for providers whose key is configured. */
  adapters: ProviderRegistry;
  /** The model registry: which models exist and whether each is usable. */
  models: ModelRegistryService;
  /** Per-provider circuit breaker (Phase 6). */
  health: ProviderHealthService;
  /** Per-model token estimation calibrated from provider counts. */
  tokens: TokenService;
  /** Context budgets, summaries and calibration (Phase 5). */
  context: ContextService;
  chat: ChatService;
  comparison: ComparisonService;
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
  comparisons?: ComparisonRepository;
  modelRegistry?: ModelRegistryRepository;
  /** Replaces the configured adapters; their models become the registry defaults. */
  providers?: ProviderEntry[];
  email?: EmailSender;
  hasher?: PasswordHasher;
  clock?: Clock;
  rateLimits?: Partial<RateLimitRules>;
  /** Shorter per-run comparison timeout, so tests need not wait two minutes. */
  comparisonRunTimeoutMs?: number;
  /** Replaces the default same-model summarizer (the summarization hook). */
  summarizer?: ConversationSummarizer;
  /** Shorter chat retry delays, so tests need not wait for real backoff. */
  retryPolicy?: Partial<RetryPolicy>;
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
  const comparisons = overrides.comparisons ?? createPrismaComparisonRepository(prisma);

  const store = createRedisStore(redis);
  const email = overrides.email ?? createEmailSender(env, logger);
  const quota = new QuotaService(
    store,
    { guest: env.GUEST_DAILY_MESSAGE_LIMIT, user: env.USER_DAILY_MESSAGE_LIMIT },
    clock,
  );
  const guestChats = new GuestConversationStore(store, clock);

  const entries = overrides.providers ?? providerEntriesFromEnv(env);
  const adapters = createAdapterRegistry(entries);
  const models = new ModelRegistryService({
    repository: overrides.modelRegistry ?? createPrismaModelRegistryRepository(prisma),
    adapters,
    // Every catalog model is listed, including providers without a key (shown as not configured).
    defaults: registryDefaults(
      overrides.providers ? entries.flatMap((entry) => [...entry.models]) : catalogModels(),
    ),
    providerNames: DEFAULT_PROVIDER_NAMES,
    clock,
    logger,
  });
  const health = new ProviderHealthService({ store, clock });

  const tokens = new TokenService(store);
  const context = new ContextService({
    store,
    conversations,
    tokens,
    summarizer: overrides.summarizer ?? new ModelSummarizer(),
    summariesEnabled: env.CONTEXT_SUMMARY_ENABLED,
    clock,
    logger,
  });

  const sessions = new SessionService({
    sessions: repositories.sessions,
    secret: env.JWT_SECRET,
    clock,
  });

  return {
    repositories,
    transaction,
    conversations,
    comparisons,
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
    adapters,
    models,
    health,
    tokens,
    context,
    chat: new ChatService({
      models,
      conversations,
      guestChats,
      context,
      health,
      quota,
      fallbackEnabled: env.CHAT_FALLBACK_ENABLED,
      ...(overrides.retryPolicy ? { retryPolicy: overrides.retryPolicy } : {}),
      clock,
      logger,
    }),
    comparison: new ComparisonService({
      models,
      comparisons,
      guestComparisons: new GuestComparisonStore(store, clock),
      quota,
      tokens,
      health,
      limits: { guest: env.GUEST_COMPARE_MAX_MODELS, user: env.USER_COMPARE_MAX_MODELS },
      clock,
      logger,
      ...(overrides.comparisonRunTimeoutMs === undefined
        ? {}
        : { runTimeoutMs: overrides.comparisonRunTimeoutMs }),
    }),
    email,
    clock,
    secret: env.JWT_SECRET,
  };
}
