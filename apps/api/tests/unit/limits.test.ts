import { AppError } from '../../src/shared/errors/app-error.js';
import { afterEach, describe, expect, it } from 'vitest';
import { GuestService } from '../../src/modules/guest/guest.service.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { GUEST_IP_LIMIT_MULTIPLIER, QuotaService } from '../../src/services/quota.service.js';
import { RateLimiter } from '../../src/services/rate-limit.service.js';
import { generateToken } from '../../src/shared/security/tokens.js';
import { TestClock } from '../helpers/fakes.js';
import { controlledRedis } from '../helpers/test-app.js';

const redis = controlledRedis();
afterEach(async () => {
  await redis.flushall();
});

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error(`expected AppError, got ${String(error)}`);
  return error;
}

describe('KeyValueStore (Redis)', () => {
  it('prefixes every key with a-ai:', async () => {
    const store = createRedisStore(redis);
    await store.setJson('guest:session:x', { ok: true }, 1000);
    expect(await redis.keys('*')).toEqual(['a-ai:guest:session:x']);
  });

  it('starts a window with a TTL on the first hit and keeps counting inside it', async () => {
    const store = createRedisStore(redis);
    const first = await store.hitWindow('w', 5_000);
    const second = await store.hitWindow('w', 5_000);
    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(second.resetInMs).toBeGreaterThan(0);
    expect(second.resetInMs).toBeLessThanOrEqual(5_000);
  });
});

describe('RateLimiter', () => {
  const rule = { name: 'test', limit: 3, windowMs: 60 };

  it('allows up to the limit, then rejects with RATE_LIMITED and Retry-After', async () => {
    const limiter = new RateLimiter(createRedisStore(redis));
    for (let attempt = 0; attempt < 3; attempt++) await limiter.consume(rule, 'subject-a');

    const error = await rejection(limiter.consume(rule, 'subject-a'));
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.statusCode).toBe(429);
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('tracks subjects independently and resets after the window', async () => {
    const limiter = new RateLimiter(createRedisStore(redis));
    for (let attempt = 0; attempt < 3; attempt++) await limiter.consume(rule, 'subject-a');
    await expect(limiter.consume(rule, 'subject-b')).resolves.toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 90));
    await expect(limiter.consume(rule, 'subject-a')).resolves.toBeUndefined();
  });
});

describe('QuotaService', () => {
  const guest = { kind: 'guest' as const, id: 'guest-1' };
  const user = { kind: 'user' as const, id: 'user-1' };

  function service(clock = new TestClock('2026-09-13T22:30:00.000Z')) {
    return {
      quota: new QuotaService(createRedisStore(redis), { guest: 2, user: 5 }, clock),
      clock,
    };
  }

  it('summarizes an untouched allowance with the next UTC midnight', async () => {
    const { quota } = service();
    expect(await quota.summary(guest)).toEqual({
      limit: 2,
      used: 0,
      remaining: 2,
      resetsAt: '2026-09-14T00:00:00.000Z',
    });
    expect((await quota.summary(user)).limit).toBe(5);
  });

  it('consumes allowance and rejects past the limit without counting the rejection', async () => {
    const { quota } = service();
    expect((await quota.consume(guest)).remaining).toBe(1);
    expect((await quota.consume(guest)).remaining).toBe(0);

    const error = await rejection(quota.consume(guest));
    expect(error.code).toBe('QUOTA_EXCEEDED');
    expect(error.retryAfterSeconds).toBe(90 * 60);
    expect((await quota.summary(guest)).used).toBe(2);
  });

  it('gives a fresh allowance on the next UTC day', async () => {
    const { quota, clock } = service();
    await quota.consume(guest);
    await quota.consume(guest);
    clock.advance(2 * 60 * 60 * 1000);
    expect(await quota.summary(guest)).toMatchObject({ used: 0, remaining: 2 });
  });

  it('caps guests on one IP even when they keep creating new guest sessions', async () => {
    const { quota } = service();
    const ipLimit = 2 * GUEST_IP_LIMIT_MULTIPLIER;
    for (let index = 0; index < ipLimit; index++) {
      await quota.consume({ kind: 'guest', id: `guest-${index}` }, { ipHash: 'ip-1' });
    }
    const error = await rejection(
      quota.consume({ kind: 'guest', id: 'fresh-guest' }, { ipHash: 'ip-1' }),
    );
    expect(error.code).toBe('QUOTA_EXCEEDED');
    expect((await quota.summary({ kind: 'guest', id: 'fresh-guest' })).used).toBe(0);
  });
});

describe('GuestService', () => {
  it('creates a guest session that can be found until it expires', async () => {
    const clock = new TestClock();
    const guests = new GuestService(createRedisStore(redis), 60, clock);
    const session = await guests.create();

    expect(session.expiresAt).toBe('2026-09-13T11:00:00.000Z');
    expect(await guests.find(session.id)).toEqual(session);

    clock.advance(60 * 60 * 1000);
    expect(await guests.find(session.id)).toBeNull();
  });

  it('rejects malformed and unknown ids without touching Redis keys', async () => {
    const guests = new GuestService(createRedisStore(redis), 60, new TestClock());
    expect(await guests.find('../../etc/passwd')).toBeNull();
    expect(await guests.find(generateToken())).toBeNull();
  });
});
