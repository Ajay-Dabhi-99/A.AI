import { describe, expect, it } from 'vitest';
import {
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
  SessionService,
} from '../../src/modules/auth/session.service.js';
import { generateToken, hmac } from '../../src/shared/security/tokens.js';
import { TestClock } from '../helpers/fakes.js';
import { createMemoryRepositories } from '../helpers/memory-repositories.js';

const SECRET = 'session-unit-test-secret-long-enough';
const meta = { userAgent: 'vitest', ipHash: 'hashed-ip' };

async function setup() {
  const repositories = createMemoryRepositories();
  const clock = new TestClock();
  const sessions = new SessionService({ sessions: repositories.sessions, secret: SECRET, clock });
  const user = await repositories.users.create({ email: 'a@example.com', passwordHash: 'x' });
  return { repositories, clock, sessions, user };
}

describe('SessionService', () => {
  it('stores only the HMAC of the token and resolves the session back to the user', async () => {
    const { repositories, sessions, user } = await setup();
    const issued = await sessions.create(user.id, meta);

    const stored = repositories.data.sessions[0];
    expect(stored?.tokenHash).toBe(hmac(SECRET, 'session', issued.token));
    expect(JSON.stringify(repositories.data.sessions)).not.toContain(issued.token);
    expect(stored).toMatchObject({ userAgent: 'vitest', ipHash: 'hashed-ip' });

    const resolved = await sessions.resolve(issued.token);
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.refreshed).toBe(false);
  });

  it('returns null for malformed, unknown and revoked tokens', async () => {
    const { sessions, user } = await setup();
    expect(await sessions.resolve('not a token')).toBeNull();
    expect(await sessions.resolve(generateToken())).toBeNull();

    const issued = await sessions.create(user.id, meta);
    await sessions.revokeToken(issued.token);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  it('expires after 30 days without activity', async () => {
    const { clock, sessions, user } = await setup();
    const issued = await sessions.create(user.id, meta);
    clock.advance(SESSION_TTL_MS);
    expect(await sessions.resolve(issued.token)).toBeNull();
  });

  it('slides the expiry forward at most once per day of activity', async () => {
    const { clock, sessions, user } = await setup();
    const issued = await sessions.create(user.id, meta);

    clock.advance(SESSION_TOUCH_INTERVAL_MS / 2);
    expect((await sessions.resolve(issued.token))?.refreshed).toBe(false);

    clock.advance(SESSION_TOUCH_INTERVAL_MS);
    const refreshed = await sessions.resolve(issued.token);
    expect(refreshed?.refreshed).toBe(true);
    expect(refreshed?.expiresAt.getTime()).toBe(clock.now().getTime() + SESSION_TTL_MS);

    // Still valid 29 days after the refresh, which is beyond the original expiry.
    clock.advance(SESSION_TTL_MS - SESSION_TOUCH_INTERVAL_MS);
    expect(await sessions.resolve(issued.token)).not.toBeNull();
  });

  it('revokes every session for a user', async () => {
    const { sessions, user } = await setup();
    const first = await sessions.create(user.id, meta);
    const second = await sessions.create(user.id, meta);
    await sessions.revokeAll(user.id);
    expect(await sessions.resolve(first.token)).toBeNull();
    expect(await sessions.resolve(second.token)).toBeNull();
  });
});
