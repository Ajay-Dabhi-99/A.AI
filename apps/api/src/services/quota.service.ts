import type { QuotaSummary } from '@a-ai/shared-types';
import type { Clock } from '../shared/clock.js';
import { AppError } from '../shared/errors/app-error.js';
import type { KeyValueStore } from './kv-store.js';

export type QuotaSubject = { kind: 'user' | 'guest'; id: string };

export type QuotaLimits = { guest: number; user: number };

const HOUR_MS = 3_600_000;

/**
 * Clearing cookies creates a new guest with a fresh quota. A second counter per
 * hashed IP caps that at this multiple of the guest limit (blueprint review #11).
 */
export const GUEST_IP_LIMIT_MULTIPLIER = 3;

/**
 * Daily message allowance, enforced server-side (blueprint §13). Windows are UTC
 * calendar days. Chat and comparison routes call `consume` before any provider
 * work starts (Phase 2 onward).
 */
export class QuotaService {
  readonly #store: KeyValueStore;
  readonly #limits: QuotaLimits;
  readonly #clock: Clock;

  constructor(store: KeyValueStore, limits: QuotaLimits, clock: Clock) {
    this.#store = store;
    this.#limits = limits;
    this.#clock = clock;
  }

  async summary(subject: QuotaSubject): Promise<QuotaSummary> {
    const window = this.#window();
    const used = await this.#store.getCount(this.#key(subject, window.day));
    return this.#toSummary(subject, used, window.resetsAt);
  }

  /** @throws AppError QUOTA_EXCEEDED; a rejected call does not use up allowance. */
  async consume(subject: QuotaSubject, options: { ipHash?: string } = {}): Promise<QuotaSummary> {
    const { day, resetsAt } = this.#window();
    const keepUntil = new Date(resetsAt.getTime() + HOUR_MS);
    const limit = this.#limit(subject);

    const counters: { key: string; limit: number }[] = [{ key: this.#key(subject, day), limit }];
    if (subject.kind === 'guest' && options.ipHash) {
      counters.push({
        key: `quota:messages:guest-ip:${options.ipHash}:${day}`,
        limit: this.#limits.guest * GUEST_IP_LIMIT_MULTIPLIER,
      });
    }

    const counts: number[] = [];
    for (const counter of counters) {
      counts.push(await this.#store.incrementUntil(counter.key, keepUntil));
    }

    if (counters.some((counter, index) => (counts[index] ?? 0) > counter.limit)) {
      await Promise.all(counters.map((counter) => this.#store.decrement(counter.key)));
      throw new AppError(
        'QUOTA_EXCEEDED',
        `You have used all ${limit} messages for today. Your allowance resets at midnight UTC.`,
        { retryAfterSeconds: Math.ceil((resetsAt.getTime() - this.#clock.now().getTime()) / 1000) },
      );
    }

    return this.#toSummary(subject, counts[0] ?? 0, resetsAt);
  }

  #limit(subject: QuotaSubject): number {
    return subject.kind === 'user' ? this.#limits.user : this.#limits.guest;
  }

  #key(subject: QuotaSubject, day: string): string {
    return `quota:messages:${subject.kind}:${subject.id}:${day}`;
  }

  #window(): { day: string; resetsAt: Date } {
    const now = this.#clock.now();
    return {
      day: now.toISOString().slice(0, 10),
      resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
    };
  }

  #toSummary(subject: QuotaSubject, used: number, resetsAt: Date): QuotaSummary {
    const limit = this.#limit(subject);
    return { limit, used, remaining: Math.max(0, limit - used), resetsAt: resetsAt.toISOString() };
  }
}
