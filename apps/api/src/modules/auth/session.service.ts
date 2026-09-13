import type { SessionRepository, UserRecord } from '../../repositories/types.js';
import type { Clock } from '../../shared/clock.js';
import { generateToken, hmac, TOKEN_FORMAT } from '../../shared/security/tokens.js';

/** Sliding session: 30 days from the last visit. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Refresh lastSeenAt/expiresAt at most once a day, so reads rarely write. */
export const SESSION_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SessionMeta = {
  userAgent: string | null;
  ipHash: string | null;
};

export type IssuedSession = { token: string; expiresAt: Date };

export type ResolvedSession = {
  sessionId: string;
  user: UserRecord;
  expiresAt: Date;
  /** True when the expiry moved, so the cookie should be re-issued. */
  refreshed: boolean;
};

/**
 * Revocable server-side sessions (ADR-008). The browser holds a random token;
 * the database holds only its HMAC.
 */
export class SessionService {
  readonly #sessions: SessionRepository;
  readonly #secret: string;
  readonly #clock: Clock;

  constructor(deps: { sessions: SessionRepository; secret: string; clock: Clock }) {
    this.#sessions = deps.sessions;
    this.#secret = deps.secret;
    this.#clock = deps.clock;
  }

  /** Pass a transaction-scoped repository to create the session inside a transaction. */
  async create(
    userId: string,
    meta: SessionMeta,
    sessions: SessionRepository = this.#sessions,
  ): Promise<IssuedSession> {
    const token = generateToken();
    const expiresAt = new Date(this.#clock.now().getTime() + SESSION_TTL_MS);
    await sessions.create({
      userId,
      tokenHash: this.#hash(token),
      expiresAt,
      userAgent: meta.userAgent,
      ipHash: meta.ipHash,
    });
    return { token, expiresAt };
  }

  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!TOKEN_FORMAT.test(token)) return null;
    const now = this.#clock.now();
    const found = await this.#sessions.findActiveByTokenHash(this.#hash(token), now);
    if (!found) return null;

    if (now.getTime() - found.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
      await this.#sessions.touch(found.id, now, expiresAt);
      return { sessionId: found.id, user: found.user, expiresAt, refreshed: true };
    }
    return { sessionId: found.id, user: found.user, expiresAt: found.expiresAt, refreshed: false };
  }

  async revokeToken(token: string): Promise<void> {
    if (!TOKEN_FORMAT.test(token)) return;
    const now = this.#clock.now();
    const found = await this.#sessions.findActiveByTokenHash(this.#hash(token), now);
    if (found) await this.#sessions.revoke(found.id, now);
  }

  async revokeAll(userId: string): Promise<void> {
    await this.#sessions.revokeAllForUser(userId, this.#clock.now());
  }

  #hash(token: string): string {
    return hmac(this.#secret, 'session', token);
  }
}
