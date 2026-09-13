import type { Redis } from 'ioredis';

/**
 * Storage interface for short-lived shared state (blueprint v4: quota and
 * rate-limit services must not depend on Redis directly). Backed by Upstash
 * Redis in every environment; tests inject a controlled Redis adapter.
 */
export interface KeyValueStore {
  /**
   * Counts one hit in a fixed window that starts at the first hit.
   * Returns the count including this hit and the time until the window resets.
   */
  hitWindow(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }>;
  /** Increments a counter that expires at an absolute time. */
  incrementUntil(key: string, expiresAt: Date): Promise<number>;
  decrement(key: string): Promise<number>;
  getCount(key: string): Promise<number>;
  setJson(key: string, value: unknown, ttlMs: number): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
}

/** Every key A.ai writes starts with this, so a shared Redis stays tidy (ADR-007). */
export const KEY_PREFIX = 'a-ai:';

type ExecResult = [error: Error | null, result: unknown][] | null;

function unwrap(results: ExecResult): unknown[] {
  if (!results) throw new Error('Redis transaction was aborted');
  return results.map(([error, value]) => {
    if (error) throw error;
    return value;
  });
}

export function createRedisStore(redis: Redis, prefix: string = KEY_PREFIX): KeyValueStore {
  const key = (name: string) => `${prefix}${name}`;

  return {
    async hitWindow(name, windowMs) {
      const k = key(name);
      // MULTI/EXEC: create the window with its TTL only if absent, then count.
      const [, count, ttl] = unwrap(
        await redis.multi().set(k, '0', 'PX', windowMs, 'NX').incr(k).pttl(k).exec(),
      );
      return { count: Number(count), resetInMs: Math.max(0, Number(ttl)) };
    },

    async incrementUntil(name, expiresAt) {
      const k = key(name);
      const [count] = unwrap(await redis.multi().incr(k).pexpireat(k, expiresAt.getTime()).exec());
      return Number(count);
    },

    decrement: (name) => redis.decr(key(name)),

    async getCount(name) {
      const value = await redis.get(key(name));
      return value === null ? 0 : Number(value);
    },

    async setJson(name, value, ttlMs) {
      await redis.set(key(name), JSON.stringify(value), 'PX', ttlMs);
    },

    async getJson<T>(name: string): Promise<T | null> {
      const value = await redis.get(key(name));
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    },

    async delete(name) {
      await redis.del(key(name));
    },
  };
}
