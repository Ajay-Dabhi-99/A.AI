import type { ChatMessage } from '@a-ai/shared-types';
import type { KeyValueStore } from '../../services/kv-store.js';
import type { Clock } from '../../shared/clock.js';
import type { GuestSession } from '../guest/guest.service.js';

/** Guests keep one rolling chat of at most this many messages. */
export const GUEST_CHAT_MAX_MESSAGES = 50;

/**
 * A guest's temporary chat in Upstash Redis (ADR-002). It expires together
 * with the guest session, so Redis TTL is the cleanup. The last write wins if
 * two tabs send at once; guests have a single-chat UI.
 */
export class GuestConversationStore {
  readonly #store: KeyValueStore;
  readonly #clock: Clock;

  constructor(store: KeyValueStore, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  async get(guestId: string): Promise<ChatMessage[]> {
    const messages = await this.#store.getJson<ChatMessage[]>(this.#key(guestId));
    return Array.isArray(messages) ? messages : [];
  }

  async save(guest: GuestSession, messages: ChatMessage[]): Promise<void> {
    const ttlMs = Date.parse(guest.expiresAt) - this.#clock.now().getTime();
    if (ttlMs <= 0) return;
    await this.#store.setJson(this.#key(guest.id), messages.slice(-GUEST_CHAT_MAX_MESSAGES), ttlMs);
  }

  async clear(guestId: string): Promise<void> {
    await this.#store.delete(this.#key(guestId));
  }

  #key(guestId: string): string {
    return `guest:conversation:${guestId}`;
  }
}
