import { z } from 'zod';

/**
 * Server-only environment contract (blueprint v4, "MVP Environment Variables").
 * Never import this module from the web app: it describes secrets. The
 * browser-safe contract lives in `@a-ai/config/web`.
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

    GUEST_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(10_080).default(1440),
    GUEST_DAILY_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),

    OPENROUTER_API_KEY: optionalString,
    GEMINI_API_KEY: optionalString,
    GROQ_API_KEY: optionalString,
  })
  .superRefine((env, ctx) => {
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
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Providers whose API key is present, in a stable order. */
export function configuredProviders(env: ServerEnv): ProviderId[] {
  return (Object.keys(PROVIDER_KEY_VARIABLES) as ProviderId[]).filter(
    (provider) => env[PROVIDER_KEY_VARIABLES[provider]] !== undefined,
  );
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
