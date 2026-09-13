import { hash, verify } from '@node-rs/argon2';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** Never throws: a malformed stored hash simply does not verify. */
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/**
 * Argon2id (the library default algorithm) with the OWASP Password Storage
 * Cheat Sheet baseline: 19 MiB memory, 2 iterations, 1 degree of parallelism.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export const argon2PasswordHasher: PasswordHasher = {
  hash: (password) => hash(password, ARGON2_OPTIONS),
  verify: async (passwordHash, password) => {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  },
};
