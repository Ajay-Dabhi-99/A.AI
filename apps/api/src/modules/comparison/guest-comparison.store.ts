import { randomUUID } from 'node:crypto';
import type { KeyValueStore } from '../../services/kv-store.js';
import type { Clock } from '../../shared/clock.js';
import type { GuestSession } from '../guest/guest.service.js';

export type GuestComparison = {
  id: string;
  guestId: string;
  prompt: string;
  createdAt: string;
};

/**
 * A guest's comparison prompt in Upstash Redis (ADR-011), kept only so a
 * failed column can be retried. Answers are not stored: guests have no
 * history. It expires with the guest session, so Redis TTL is the cleanup.
 */
export class GuestComparisonStore {
  readonly #store: KeyValueStore;
  readonly #clock: Clock;

  constructor(store: KeyValueStore, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  async create(guest: GuestSession, prompt: string): Promise<GuestComparison> {
    const now = this.#clock.now();
    const comparison: GuestComparison = {
      id: randomUUID(),
      guestId: guest.id,
      prompt,
      createdAt: now.toISOString(),
    };
    const ttlMs = Date.parse(guest.expiresAt) - now.getTime();
    if (ttlMs > 0) await this.#store.setJson(this.#key(comparison.id), comparison, ttlMs);
    return comparison;
  }

  /** Null unless it exists and belongs to this guest. */
  async find(id: string, guestId: string): Promise<GuestComparison | null> {
    const comparison = await this.#store.getJson<GuestComparison>(this.#key(id));
    return comparison?.id === id && comparison.guestId === guestId ? comparison : null;
  }

  #key(id: string): string {
    return `guest:comparison:${id}`;
  }
}
