import { describe, expect, it } from 'vitest';
import { parseWebEnv } from '../src/web.js';

describe('parseWebEnv', () => {
  it('defaults to same-origin when VITE_API_URL is unset or blank', () => {
    expect(parseWebEnv({}).VITE_API_URL).toBe('');
    expect(parseWebEnv({ VITE_API_URL: '  ' }).VITE_API_URL).toBe('');
  });

  it('normalizes a trailing slash', () => {
    expect(parseWebEnv({ VITE_API_URL: 'https://api.a-ai.app/' }).VITE_API_URL).toBe(
      'https://api.a-ai.app',
    );
  });

  it('rejects URLs with a path or a non-http scheme', () => {
    expect(() => parseWebEnv({ VITE_API_URL: 'https://api.a-ai.app/v1' })).toThrow(/VITE_API_URL/);
    expect(() => parseWebEnv({ VITE_API_URL: 'ftp://api.a-ai.app' })).toThrow(/VITE_API_URL/);
  });
});
