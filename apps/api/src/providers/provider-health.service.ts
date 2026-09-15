import type { AIProviderError } from '@a-ai/ai-core';
import type { ErrorCode, ProviderHealth, ProviderInfo } from '@a-ai/shared-types';
import type { KeyValueStore } from '../services/kv-store.js';
import type { Clock } from '../shared/clock.js';

/** Consecutive provider failures that open the circuit. */
export const CIRCUIT_FAILURE_THRESHOLD = 3;
/** How long an open circuit keeps a provider out of fallback selection. */
export const CIRCUIT_COOLDOWN_MS = 30_000;
/** A 429's Retry-After opens the circuit for at most this long. */
export const MAX_RATE_LIMIT_OPEN_MS = 60_000;
/** A success is written at most this often while a provider stays healthy (saves Redis commands). */
export const SUCCESS_WRITE_INTERVAL_MS = 60_000;
const HEALTH_TTL_MS = 24 * 3_600_000;

type StoredHealth = {
  consecutiveFailures: number;
  /** Epoch milliseconds; null when the circuit is closed. */
  openUntil: number | null;
  lastErrorCode: ErrorCode | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
};

const EMPTY: StoredHealth = {
  consecutiveFailures: 0,
  openUntil: null,
  lastErrorCode: null,
  lastFailureAt: null,
  lastSuccessAt: null,
};

function isStoredHealth(value: unknown): value is StoredHealth {
  const candidate = value as Partial<StoredHealth> | null;
  return typeof candidate?.consecutiveFailures === 'number';
}

/**
 * Per-provider circuit breaker shared by every API instance through Upstash
 * Redis (blueprint §14: provider health is measured separately, and a
 * degraded provider never makes the API look dead). Updates are
 * read-modify-write: two instances failing at the same moment can undercount
 * by one, which only delays opening the circuit by one failure.
 */
export class ProviderHealthService {
  readonly #store: KeyValueStore;
  readonly #clock: Clock;

  constructor(deps: { store: KeyValueStore; clock: Clock }) {
    this.#store = deps.store;
    this.#clock = deps.clock;
  }

  async isDown(providerId: string): Promise<boolean> {
    const health = await this.#read(providerId);
    return health.openUntil !== null && health.openUntil > this.#clock.now().getTime();
  }

  async downProviders(providerIds: Iterable<string>): Promise<Set<string>> {
    const down = new Set<string>();
    for (const id of new Set(providerIds)) {
      if (await this.isDown(id)) down.add(id);
    }
    return down;
  }

  async recordSuccess(providerId: string): Promise<void> {
    const now = this.#clock.now();
    const health = await this.#read(providerId);
    const clean = health.consecutiveFailures === 0 && health.openUntil === null;
    const recentlyWritten =
      health.lastSuccessAt !== null &&
      now.getTime() - Date.parse(health.lastSuccessAt) < SUCCESS_WRITE_INTERVAL_MS;
    if (clean && recentlyWritten) return;
    await this.#write(providerId, {
      ...health,
      consecutiveFailures: 0,
      openUntil: null,
      lastSuccessAt: now.toISOString(),
    });
  }

  async recordFailure(providerId: string, error: AIProviderError): Promise<void> {
    const now = this.#clock.now().getTime();
    const health = await this.#read(providerId);
    const consecutiveFailures = health.consecutiveFailures + 1;

    let openUntil = health.openUntil !== null && health.openUntil > now ? health.openUntil : null;
    if (error.code === 'RATE_LIMITED' && (error.retryAfterSeconds ?? 0) > 0) {
      const wait = Math.min((error.retryAfterSeconds as number) * 1_000, MAX_RATE_LIMIT_OPEN_MS);
      openUntil = Math.max(openUntil ?? 0, now + wait);
    }
    // After a cooldown the next attempt is a probe: one more failure reopens the circuit.
    if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      openUntil = Math.max(openUntil ?? 0, now + CIRCUIT_COOLDOWN_MS);
    }

    await this.#write(providerId, {
      ...health,
      consecutiveFailures,
      openUntil,
      lastErrorCode: error.code,
      lastFailureAt: new Date(now).toISOString(),
    });
  }

  /** Health for every provider the registry knows about, in the given order. */
  async snapshot(providers: readonly ProviderInfo[]): Promise<ProviderHealth[]> {
    const now = this.#clock.now().getTime();
    const result: ProviderHealth[] = [];
    for (const provider of providers) {
      const health = await this.#read(provider.id);
      const open = health.openUntil !== null && health.openUntil > now;
      result.push({
        id: provider.id,
        name: provider.name,
        configured: provider.configured,
        status: !provider.configured
          ? 'not_configured'
          : open
            ? 'down'
            : health.consecutiveFailures > 0
              ? 'degraded'
              : 'healthy',
        consecutiveFailures: health.consecutiveFailures,
        lastErrorCode: health.lastErrorCode,
        retryAt: open ? new Date(health.openUntil as number).toISOString() : null,
        lastFailureAt: health.lastFailureAt,
        lastSuccessAt: health.lastSuccessAt,
      });
    }
    return result;
  }

  async #read(providerId: string): Promise<StoredHealth> {
    const stored = await this.#store.getJson<unknown>(this.#key(providerId));
    return isStoredHealth(stored) ? { ...EMPTY, ...stored } : { ...EMPTY };
  }

  async #write(providerId: string, health: StoredHealth): Promise<void> {
    await this.#store.setJson(this.#key(providerId), health, HEALTH_TTL_MS);
  }

  #key(providerId: string): string {
    return `health:provider:${providerId}`;
  }
}
