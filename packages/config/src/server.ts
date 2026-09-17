import { z } from 'zod';

/**
 * Server-only environment contract (blueprint v4, "MVP Environment Variables",
 * extended in Phase 1 for accounts and email). Never import this module from
 * the web app: it describes secrets. The browser-safe contract lives in
 * `@a-ai/config/web`.
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const PROVIDER_KEY_VARIABLES = {
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
} as const;

export type ProviderId = keyof typeof PROVIDER_KEY_VARIABLES;

/** Empty strings in .env files mean "not configured", not "configured as empty". */
const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection string');

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const originSchema = z
  .string()
  .transform((value) => value.trim().replace(/\/+$/, ''))
  .refine(isOrigin, 'must look like https://host[:port] with no path');

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

    DATABASE_URL: postgresUrl,
    DIRECT_URL: optionalString.pipe(postgresUrl.optional()),

    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\/.+/, 'must be a redis:// or rediss:// URL (Upstash uses rediss://)'),

    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),

    CORS_ORIGIN: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim().replace(/\/+$/, ''))
          .filter(Boolean),
      )
      .pipe(
        z
          .array(
            z
              .string()
              .refine(isOrigin, 'each origin must look like https://host[:port] with no path'),
          )
          .min(1, 'at least one origin is required'),
      ),

    /** Public web app origin used in emailed links. Defaults to the first CORS_ORIGIN. */
    APP_URL: optionalString.pipe(originSchema.optional()),

    GUEST_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(10_080).default(1440),
    GUEST_DAILY_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
    USER_DAILY_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(200),
    /** Models one comparison may run at once (blueprint §13). 2 to 4: the API's hard range. */
    GUEST_COMPARE_MAX_MODELS: z.coerce.number().int().min(2).max(4).default(2),
    USER_COMPARE_MAX_MODELS: z.coerce.number().int().min(2).max(4).default(4),
    /** Summarize older messages with the chat model when a conversation outgrows its context (ADR-012). */
    CONTEXT_SUMMARY_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    /** Suggest follow-up questions after each answer (MODEL-067); one small extra model call. */
    CHAT_SUGGESTIONS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    /** Supabase project URL for Storage (Phase 8). With the key, enables image uploads. */
    SUPABASE_URL: optionalString.pipe(originSchema.optional()),
    /** Server-side only. Never expose it to the web app. */
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SUPABASE_STORAGE_BUCKET: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lowercase letters, digits and hyphens')
      .default('a-ai-attachments'),
    /** Largest accepted image upload, in bytes (100 KiB to 20 MiB, default 5 MiB). */
    ATTACHMENT_MAX_BYTES: z.coerce.number().int().min(102_400).max(20_971_520).default(5_242_880),
    /** Largest voice recording accepted for transcription (100 KiB to 25 MiB, default 10 MiB). */
    AUDIO_MAX_BYTES: z.coerce.number().int().min(102_400).max(26_214_400).default(10_485_760),
    /** Largest generated video stored (1 MiB to 200 MiB, default 50 MiB). */
    VIDEO_MAX_BYTES: z.coerce.number().int().min(1_048_576).max(209_715_200).default(52_428_800),
    /**
     * Proxies in front of the API whose X-Forwarded-For entries are trusted for the client
     * address (ADR-017). Unset: 1 in production (Render), 0 elsewhere.
     */
    TRUST_PROXY_HOPS: optionalString
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .pipe(z.number().int().min(0).max(5).optional()),
    /** Sentry DSN for API error reports; empty sends nothing (ADR-017). */
    SENTRY_DSN: optionalString.pipe(z.url().optional()),
    /** Sentry environment name; defaults to NODE_ENV. */
    SENTRY_ENVIRONMENT: optionalString,
    /** Set by Render on each deploy; reported by GET /health so a smoke test can confirm the build. */
    RENDER_GIT_COMMIT: optionalString,
    /** Let another healthy model answer when the chosen one fails before sending text (ADR-013). */
    CHAT_FALLBACK_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    /** Sender shown in emails, e.g. `A.ai <no-reply@your-domain.com>`. */
    EMAIL_FROM: z
      .string()
      .trim()
      .min(3)
      .regex(/@/, 'must contain an email address')
      .default('A.ai <onboarding@resend.dev>'),
    /** Resend API key. Without it (development/test only) emails are written to the log. */
    RESEND_API_KEY: optionalString,

    OPENROUTER_API_KEY: optionalString,
    GEMINI_API_KEY: optionalString,
    GROQ_API_KEY: optionalString,

    /** Cloudflare Workers AI, used for free image generation (set both or neither). */
    CLOUDFLARE_ACCOUNT_ID: optionalString,
    CLOUDFLARE_AI_API_TOKEN: optionalString,
  })
  .superRefine((env, ctx) => {
    // Storage needs both or neither: half a configuration would fail on the first upload.
    if ((env.SUPABASE_URL === undefined) !== (env.SUPABASE_SERVICE_ROLE_KEY === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.SUPABASE_URL === undefined ? 'SUPABASE_URL' : 'SUPABASE_SERVICE_ROLE_KEY'],
        message: 'set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY together (or neither)',
      });
    }
    if ((env.CLOUDFLARE_ACCOUNT_ID === undefined) !== (env.CLOUDFLARE_AI_API_TOKEN === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [
          env.CLOUDFLARE_ACCOUNT_ID === undefined
            ? 'CLOUDFLARE_ACCOUNT_ID'
            : 'CLOUDFLARE_AI_API_TOKEN',
        ],
        message: 'set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN together (or neither)',
      });
    }
    if (env.NODE_ENV !== 'production') return;

    if (!env.REDIS_URL.startsWith('rediss://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'production requires TLS (rediss://)',
      });
    }
    env.CORS_ORIGIN.forEach((origin, index) => {
      if (!origin.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGIN', index],
          message: 'production origins must use https://',
        });
      }
    });
    if (env.APP_URL && !env.APP_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'production requires https://' });
    }
    if (!env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'production requires a real email provider (verification and reset emails)',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Providers whose API key is present, in a stable order. */
export function configuredProviders(env: ServerEnv): ProviderId[] {
  return (Object.keys(PROVIDER_KEY_VARIABLES) as ProviderId[]).filter(
    (provider) => env[PROVIDER_KEY_VARIABLES[provider]] !== undefined,
  );
}

/** Origin of the web app for links in emails. */
export function appUrl(env: ServerEnv): string {
  return env.APP_URL ?? (env.CORS_ORIGIN[0] as string);
}

/** Raised at boot when configuration is invalid. Messages never include values. */
export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
