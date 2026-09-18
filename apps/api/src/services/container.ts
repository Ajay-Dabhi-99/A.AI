import type { ProviderRegistry } from '@a-ai/ai-core';
import { appUrl, type ServerEnv } from '@a-ai/config/server';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import type { RetryPolicy } from '../ai/retry-policy.js';
import { ModelSummarizer, type ConversationSummarizer } from '../ai/summarizer.js';
import { TokenService } from '../ai/token.service.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { InstructionsService } from '../modules/users/instructions.service.js';
import { ProfileService } from '../modules/users/profile.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { ChatService } from '../modules/chat/chat.service.js';
import { ChatSearchService } from '../modules/chat/search.service.js';
import { ShareService } from '../modules/chat/share.service.js';
import {
  createPrismaShareRepository,
  type ShareRepository,
} from '../repositories/share.repository.js';
import { SuggestionService } from '../modules/chat/suggestion.service.js';
import { GuestConversationStore } from '../modules/chat/guest-conversation.store.js';
import { ComparisonService } from '../modules/comparison/comparison.service.js';
import { GuestComparisonStore } from '../modules/comparison/guest-comparison.store.js';
import { GuestService } from '../modules/guest/guest.service.js';
import {
  catalogModels,
  createAdapterRegistry,
  DEFAULT_PROVIDER_NAMES,
  PREFERRED_DEFAULT_MODEL,
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
import { HistoryService } from '../modules/history/history.service.js';
import {
  createPrismaHistoryRepository,
  type HistoryRepository,
} from '../repositories/history.repository.js';
import type { MediaGenerationProvider, TranscriptionProvider } from '@a-ai/ai-core';
import { CloudflareImageProvider, GroqTranscriptionProvider } from '@a-ai/ai-providers';
import type { MediaJobKind } from '@a-ai/shared-types';
import { AttachmentService } from '../modules/attachments/attachment.service.js';
import { TranscriptionService } from '../modules/audio/transcription.service.js';
import { JobCenter } from '../modules/jobs/job-center.js';
import { MediaJobService } from '../modules/jobs/media-job.service.js';
import type { RateLimitRule } from './rate-limit.service.js';
import {
  createPrismaAttachmentRepository,
  type AttachmentRepository,
} from '../repositories/attachment.repository.js';
import {
  createPrismaGenerationJobRepository,
  type GenerationJobRepository,
} from '../repositories/generation-job.repository.js';
import { ContextService } from './context.service.js';
import {
  createSupabaseStorage,
  disabledStorage,
  type ObjectStorage,
} from './storage/object-storage.js';
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
  profile: ProfileService;
  /** Personal instructions sent with chats (MODEL-069). */
  instructions: InstructionsService;
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
  /** Public read-only chat links (MODEL-070). */
  shares: ShareService;
  /** Search in chat titles and messages (MODEL-071). */
  chatSearch: ChatSearchService;
  /** Follow-up questions after an answer (MODEL-067). */
  suggestions: SuggestionService;
  comparison: ComparisonService;
  /** Saved history, run detail and usage analytics (Phase 7). */
  history: HistoryService;
  /** Image uploads in private object storage (Phase 8). */
  attachments: AttachmentService;
  /** Image and video generation jobs; each kind is off while it has no provider (Phases 8–9). */
  jobs: JobCenter;
  /** Speech-to-text; off without a speech-to-text key (Phase 9). */
  transcription: TranscriptionService;
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
  history?: HistoryRepository;
  attachments?: AttachmentRepository;
  /** Replaces Supabase Storage (or the disabled storage when it is not configured). */
  storage?: ObjectStorage;
  generationJobs?: GenerationJobRepository;
  /** Public chat snapshots (MODEL-070). */
  shares?: ShareRepository;
  /** Replaces the image providers built from the environment (Cloudflare Workers AI). */
  imageProviders?: MediaGenerationProvider[];
  imageJobTimeoutMs?: number;
  /** Video providers; production registers none yet (Phase 9). */
  videoProviders?: MediaGenerationProvider[];
  videoJobTimeoutMs?: number;
  /** Faster job event streams, so tests need not wait a second per update. */
  jobStreamPollMs?: number;
  /** Replaces the speech-to-text adapter; null turns voice input off. */
  transcription?: TranscriptionProvider | null;
};

/** Free image generation runs on Cloudflare Workers AI when its account is configured. */
function imageProvidersFromEnv(env: ServerEnv): MediaGenerationProvider[] {
  return env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_API_TOKEN
    ? [
        new CloudflareImageProvider({
          accountId: env.CLOUDFLARE_ACCOUNT_ID,
          apiToken: env.CLOUDFLARE_AI_API_TOKEN,
        }),
      ]
    : [];
}

function storageFromEnv(env: ServerEnv): ObjectStorage {
  return env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseStorage({
        url: env.SUPABASE_URL,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
        bucket: env.SUPABASE_STORAGE_BUCKET,
      })
    : disabledStorage;
}

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
    preferredDefault: PREFERRED_DEFAULT_MODEL,
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

  const rateLimiter = new RateLimiter(store);
  const rateLimits = { ...RATE_LIMITS, ...overrides.rateLimits };
  const attachments = new AttachmentService({
    repository: overrides.attachments ?? createPrismaAttachmentRepository(prisma),
    storage: overrides.storage ?? storageFromEnv(env),
    rateLimiter,
    uploadRule: rateLimits.uploadByUser,
    maxBytes: env.ATTACHMENT_MAX_BYTES,
    videoMaxBytes: env.VIDEO_MAX_BYTES,
    clock,
    logger,
  });

  const generationJobs = overrides.generationJobs ?? createPrismaGenerationJobRepository(prisma);
  const mediaJobs = (
    kind: MediaJobKind,
    providers: MediaGenerationProvider[],
    rule: RateLimitRule,
    timeoutMs: number | undefined,
  ) =>
    new MediaJobService({
      kind,
      providers,
      jobs: generationJobs,
      attachments,
      conversations,
      store,
      rateLimiter,
      rule,
      clock,
      logger,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  const transcriptionProvider =
    overrides.transcription !== undefined
      ? overrides.transcription
      : env.GROQ_API_KEY
        ? new GroqTranscriptionProvider({ apiKey: env.GROQ_API_KEY })
        : null;

  const instructions = new InstructionsService(repositories);

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
    rateLimiter,
    rateLimits,
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
    profile: new ProfileService(repositories, clock),
    instructions,
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
      attachments,
      fallbackEnabled: env.CHAT_FALLBACK_ENABLED,
      instructions,
      ...(overrides.retryPolicy ? { retryPolicy: overrides.retryPolicy } : {}),
      clock,
      logger,
    }),
    chatSearch: new ChatSearchService(conversations),
    shares: new ShareService({
      shares: overrides.shares ?? createPrismaShareRepository(prisma),
      conversations,
      models,
      clock,
    }),
    suggestions: new SuggestionService({
      enabled: env.CHAT_SUGGESTIONS_ENABLED,
      models,
      health,
      rateLimiter,
      rules: {
        user: rateLimits.suggestByUser,
        guest: rateLimits.suggestByGuest,
        guestIp: rateLimits.suggestByIp,
      },
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
    history: new HistoryService({
      history: overrides.history ?? createPrismaHistoryRepository(prisma),
      conversations,
      attachments,
      clock,
      logger,
    }),
    attachments,
    jobs: new JobCenter({
      jobs: generationJobs,
      services: {
        image: mediaJobs(
          'image',
          overrides.imageProviders ?? imageProvidersFromEnv(env),
          rateLimits.imageByUser,
          overrides.imageJobTimeoutMs,
        ),
        video: mediaJobs(
          'video',
          overrides.videoProviders ?? [],
          rateLimits.videoByUser,
          overrides.videoJobTimeoutMs,
        ),
      },
      ...(overrides.jobStreamPollMs === undefined
        ? {}
        : { streamPollMs: overrides.jobStreamPollMs }),
    }),
    transcription: new TranscriptionService({
      provider: transcriptionProvider,
      rateLimiter,
      rules: {
        user: rateLimits.transcribeByUser,
        guest: rateLimits.transcribeByGuest,
        guestIp: rateLimits.transcribeByIp,
      },
      maxBytes: env.AUDIO_MAX_BYTES,
      logger,
    }),
    email,
    clock,
    secret: env.JWT_SECRET,
  };
}
