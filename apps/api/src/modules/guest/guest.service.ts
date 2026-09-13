import type { Clock } from '../../shared/clock.js';
import { generateToken, TOKEN_FORMAT } from '../../shared/security/tokens.js';
import type { KeyValueStore } from '../../services/kv-store.js';

export type GuestSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
};

/**
 * Temporary guest identities in Upstash Redis (ADR-002). Redis TTL is the
 * cleanup mechanism; nothing about a guest is written to PostgreSQL.
 */
export class GuestService {
  readonly #store: KeyValueStore;
  readonly #ttlMs: number;
  readonly #clock: Clock;

  constructor(store: KeyValueStore, ttlMinutes: number, clock: Clock) {
    this.#store = store;
    this.#ttlMs = ttlMinutes * 60_000;
    this.#clock = clock;
  }

  async create(): Promise<GuestSession> {
    const now = this.#clock.now();
    const session: GuestSession = {
      id: generateToken(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#ttlMs).toISOString(),
    };
    await this.#store.setJson(this.#key(session.id), session, this.#ttlMs);
    return session;
  }

  async find(id: string): Promise<GuestSession | null> {
    if (!TOKEN_FORMAT.test(id)) return null;
    const session = await this.#store.getJson<GuestSession>(this.#key(id));
    if (!session || session.id !== id) return null;
    if (Date.parse(session.expiresAt) <= this.#clock.now().getTime()) return null;
    return session;
  }

  #key(id: string): string {
    return `guest:session:${id}`;
  }
}
