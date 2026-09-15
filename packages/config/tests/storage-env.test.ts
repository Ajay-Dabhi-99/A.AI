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
