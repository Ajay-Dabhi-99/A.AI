import { describe, expect, it } from 'vitest';
import { argon2PasswordHasher } from '../../src/shared/security/password.js';
import { generateToken, hmac, TOKEN_FORMAT } from '../../src/shared/security/tokens.js';

describe('generateToken', () => {
  it('produces unique 43-character base64url tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(TOKEN_FORMAT);
  });
});

describe('hmac', () => {
  it('is deterministic per secret, purpose and value', () => {
    expect(hmac('secret-one', 'session', 'abc')).toBe(hmac('secret-one', 'session', 'abc'));
    expect(hmac('secret-one', 'session', 'abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates purposes and secrets', () => {
    expect(hmac('secret-one', 'session', 'abc')).not.toBe(hmac('secret-one', 'email-link', 'abc'));
    expect(hmac('secret-one', 'session', 'abc')).not.toBe(hmac('secret-two', 'session', 'abc'));
  });
});

describe('argon2PasswordHasher', () => {
  it('hashes with argon2id and verifies only the right password', async () => {
    const hash = await argon2PasswordHasher.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await argon2PasswordHasher.verify(hash, 'correct horse battery staple')).toBe(true);
    expect(await argon2PasswordHasher.verify(hash, 'wrong password')).toBe(false);
  });

  it('salts every hash', async () => {
    const [first, second] = await Promise.all([
      argon2PasswordHasher.hash('same password here'),
      argon2PasswordHasher.hash('same password here'),
    ]);
    expect(first).not.toBe(second);
  });

  it('returns false instead of throwing for a malformed stored hash', async () => {
    expect(await argon2PasswordHasher.verify('not-a-hash', 'anything')).toBe(false);
  });
});
