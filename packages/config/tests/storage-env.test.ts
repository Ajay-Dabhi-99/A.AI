import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseServerEnv } from '../src/server.js';

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

describe('image storage settings (Phase 8)', () => {
  it('leaves uploads disabled with sensible limits by default', () => {
    const env = parseServerEnv(valid);
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.SUPABASE_STORAGE_BUCKET).toBe('a-ai-attachments');
    expect(env.ATTACHMENT_MAX_BYTES).toBe(5_242_880);
  });

  it('normalizes the project URL and treats empty values as not configured', () => {
    const env = parseServerEnv({
      ...valid,
      SUPABASE_URL: 'https://abcd.supabase.co/',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    });
    expect(env.SUPABASE_URL).toBe('https://abcd.supabase.co');
    expect(
      parseServerEnv({ ...valid, SUPABASE_URL: ' ', SUPABASE_SERVICE_ROLE_KEY: '' }).SUPABASE_URL,
    ).toBeUndefined();
  });

  it('requires the URL and the service-role key together, and never echoes values', () => {
    const issues = issuesFor({ ...valid, SUPABASE_SERVICE_ROLE_KEY: 'super-secret-value' });
    expect(issues).toEqual([
      'SUPABASE_URL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY together (or neither)',
    ]);
    expect(issues.join(' ')).not.toContain('super-secret-value');
    expect(issuesFor({ ...valid, SUPABASE_URL: 'https://abcd.supabase.co' })).toEqual([
      'SUPABASE_SERVICE_ROLE_KEY: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY together (or neither)',
    ]);
  });

  it('rejects bad bucket names and out-of-range upload sizes', () => {
    expect(issuesFor({ ...valid, SUPABASE_STORAGE_BUCKET: 'Bad_Bucket' })).toHaveLength(1);
    expect(issuesFor({ ...valid, ATTACHMENT_MAX_BYTES: '50' })).toHaveLength(1);
    expect(issuesFor({ ...valid, ATTACHMENT_MAX_BYTES: '104857600' })).toHaveLength(1);
    expect(
      issuesFor({ ...valid, SUPABASE_URL: 'https://abcd.supabase.co/rest/v1' }),
    ).not.toHaveLength(0);
  });
});

describe('image generation settings (Cloudflare Workers AI)', () => {
  it('is off by default and reads both values when set', () => {
    const off = parseServerEnv(valid);
    expect(off.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    expect(off.CLOUDFLARE_AI_API_TOKEN).toBeUndefined();
    const on = parseServerEnv({
      ...valid,
      CLOUDFLARE_ACCOUNT_ID: ' account-1 ',
      CLOUDFLARE_AI_API_TOKEN: 'token-1',
    });
    expect([on.CLOUDFLARE_ACCOUNT_ID, on.CLOUDFLARE_AI_API_TOKEN]).toEqual([
      'account-1',
      'token-1',
    ]);
  });

  it('requires the account id and token together, and never echoes values', () => {
    const issues = issuesFor({ ...valid, CLOUDFLARE_AI_API_TOKEN: 'secret-cloudflare-token' });
    expect(issues).toEqual([
      'CLOUDFLARE_ACCOUNT_ID: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN together (or neither)',
    ]);
    expect(issues.join(' ')).not.toContain('secret-cloudflare-token');
    expect(issuesFor({ ...valid, CLOUDFLARE_ACCOUNT_ID: 'account-1' })).toEqual([
      'CLOUDFLARE_AI_API_TOKEN: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN together (or neither)',
    ]);
  });
});
