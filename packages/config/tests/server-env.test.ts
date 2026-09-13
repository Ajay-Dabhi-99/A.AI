import { describe, expect, it } from 'vitest';
import { configuredProviders, EnvValidationError, parseServerEnv } from '../src/server.js';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres.ref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  REDIS_URL: 'rediss://default:token@example.upstash.io:6379',
  JWT_SECRET: 'x'.repeat(32),
  CORS_ORIGIN: 'http://localhost:5180',
};

function issuesFor(source: Record<string, string | undefined>): readonly string[] {
  try {
    parseServerEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.issues;
    throw error;
  }
  throw new Error('expected parseServerEnv to throw');
}

describe('parseServerEnv', () => {
  it('applies defaults for optional settings', () => {
    const env = parseServerEnv(valid);
    expect(env).toMatchObject({
      PORT: 4000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      CORS_ORIGIN: ['http://localhost:5180'],
      GUEST_SESSION_TTL_MINUTES: 1440,
      GUEST_DAILY_MESSAGE_LIMIT: 20,
    });
    expect(env.DIRECT_URL).toBeUndefined();
  });

  it('coerces numeric settings and validates their bounds', () => {
    expect(
      parseServerEnv({ ...valid, GUEST_DAILY_MESSAGE_LIMIT: '5' }).GUEST_DAILY_MESSAGE_LIMIT,
    ).toBe(5);
    expect(issuesFor({ ...valid, GUEST_SESSION_TTL_MINUTES: '1' })[0]).toMatch(
      /^GUEST_SESSION_TTL_MINUTES/,
    );
    expect(issuesFor({ ...valid, PORT: 'eighty' })[0]).toMatch(/^PORT/);
  });

  it('treats blank optional values as not configured', () => {
    const env = parseServerEnv({
      ...valid,
      GEMINI_API_KEY: '   ',
      DIRECT_URL: '',
      GROQ_API_KEY: 'gsk_live',
    });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.DIRECT_URL).toBeUndefined();
    expect(env.GROQ_API_KEY).toBe('gsk_live');
  });

  it('validates DIRECT_URL when present', () => {
    expect(issuesFor({ ...valid, DIRECT_URL: 'https://supabase.co' })[0]).toMatch(/^DIRECT_URL/);
  });

  it('parses comma-separated origins and strips trailing slashes', () => {
    const env = parseServerEnv({
      ...valid,
      CORS_ORIGIN: 'http://localhost:5180/, https://app.example.com',
    });
    expect(env.CORS_ORIGIN).toEqual(['http://localhost:5180', 'https://app.example.com']);
  });

  it('reports every missing required variable at once', () => {
    const issues = issuesFor({});
    for (const name of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'CORS_ORIGIN']) {
      expect(issues.some((issue) => issue.startsWith(`${name}:`))).toBe(true);
    }
  });

  it('rejects a short JWT_SECRET without echoing the value', () => {
    const issues = issuesFor({ ...valid, JWT_SECRET: 'hunter2-secret' });
    expect(issues.join('\n')).toContain('JWT_SECRET');
    expect(issues.join('\n')).not.toContain('hunter2-secret');
  });

  it('rejects non-postgres database URLs, non-redis URLs and origins with paths', () => {
    expect(issuesFor({ ...valid, DATABASE_URL: 'mysql://db' })[0]).toMatch(/^DATABASE_URL/);
    expect(issuesFor({ ...valid, REDIS_URL: 'memory://' })[0]).toMatch(/^REDIS_URL/);
    expect(issuesFor({ ...valid, CORS_ORIGIN: 'http://localhost:5180/app' })[0]).toMatch(
      /^CORS_ORIGIN/,
    );
  });

  it('requires TLS Redis and https origins in production', () => {
    const issues = issuesFor({
      ...valid,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://localhost:6379',
    });
    expect(issues).toEqual([
      expect.stringMatching(/^REDIS_URL: .*rediss/),
      expect.stringMatching(/^CORS_ORIGIN\.0: .*https/),
    ]);
  });
});

describe('configuredProviders', () => {
  it('lists only providers with keys, in a stable order', () => {
    expect(configuredProviders(parseServerEnv(valid))).toEqual([]);
    expect(
      configuredProviders(parseServerEnv({ ...valid, GROQ_API_KEY: 'g', OPENROUTER_API_KEY: 'o' })),
    ).toEqual(['openrouter', 'groq']);
  });
});
