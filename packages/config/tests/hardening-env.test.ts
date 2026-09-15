import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseServerEnv } from '../src/server.js';
import { parseWebEnv } from '../src/web.js';

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
  return [];
}

describe('production hosting settings (Phase 10)', () => {
  it('leaves proxy trust, Sentry and the commit unset by default', () => {
    const env = parseServerEnv(valid);
    expect(env.TRUST_PROXY_HOPS).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.RENDER_GIT_COMMIT).toBeUndefined();
  });

  it('bounds the trusted proxy hops', () => {
    expect(parseServerEnv({ ...valid, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
    expect(parseServerEnv({ ...valid, TRUST_PROXY_HOPS: '' }).TRUST_PROXY_HOPS).toBeUndefined();
    expect(issuesFor({ ...valid, TRUST_PROXY_HOPS: '9' })[0]).toMatch(/^TRUST_PROXY_HOPS/);
    expect(issuesFor({ ...valid, TRUST_PROXY_HOPS: 'all' })[0]).toMatch(/^TRUST_PROXY_HOPS/);
  });

  it('requires a real URL for the Sentry DSN without echoing it', () => {
    expect(
      parseServerEnv({ ...valid, SENTRY_DSN: 'https://public@o1.ingest.sentry.io/2' }).SENTRY_DSN,
    ).toBe('https://public@o1.ingest.sentry.io/2');
    const issues = issuesFor({ ...valid, SENTRY_DSN: 'not-a-dsn-value' });
    expect(issues[0]).toMatch(/^SENTRY_DSN/);
    expect(issues.join(' ')).not.toContain('not-a-dsn-value');
  });

  it('accepts an optional browser Sentry DSN', () => {
    expect(parseWebEnv({}).VITE_SENTRY_DSN).toBeUndefined();
    expect(parseWebEnv({ VITE_SENTRY_DSN: ' ' }).VITE_SENTRY_DSN).toBeUndefined();
    expect(
      parseWebEnv({ VITE_SENTRY_DSN: 'https://public@o1.ingest.sentry.io/3' }).VITE_SENTRY_DSN,
    ).toBe('https://public@o1.ingest.sentry.io/3');
    expect(() => parseWebEnv({ VITE_SENTRY_DSN: 'nope' })).toThrow(/VITE_SENTRY_DSN/);
  });
});
