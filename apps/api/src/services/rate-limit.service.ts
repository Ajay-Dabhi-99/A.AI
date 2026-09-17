import { AppError } from '../shared/errors/app-error.js';
import type { KeyValueStore } from './kv-store.js';

export type RateLimitRule = {
  /** Stable name, part of the Redis key. */
  name: string;
  limit: number;
  windowMs: number;
};

const MINUTE = 60_000;

/**
 * Limits are per hashed subject (IP or email), stored in Upstash so they hold
 * across API restarts and multiple instances.
 */
export const RATE_LIMITS = {
  /** Every /api request, per IP. */
  api: { name: 'api-ip', limit: 300, windowMs: MINUTE },
  loginByIp: { name: 'login-ip', limit: 20, windowMs: 15 * MINUTE },
  /** Slows password guessing against one account, whatever IPs are used. */
  loginByEmail: { name: 'login-email', limit: 10, windowMs: 15 * MINUTE },
  signupByIp: { name: 'signup-ip', limit: 10, windowMs: 60 * MINUTE },
  /** Emails sent to one address (signup, resend, forgot): stops inbox flooding. */
  emailByAddress: { name: 'email-address', limit: 3, windowMs: 60 * MINUTE },
  emailByIp: { name: 'email-ip', limit: 20, windowMs: 60 * MINUTE },
  /** Verify-email and reset-password link submissions. */
  linkByIp: { name: 'link-ip', limit: 30, windowMs: 15 * MINUTE },
  /** Image uploads per signed-in user (Phase 8). */
  uploadByUser: { name: 'upload-user', limit: 30, windowMs: 60 * MINUTE },
  /** Voice transcriptions (Phase 9): per user, per guest session, and per guest IP. */
  transcribeByUser: { name: 'stt-user', limit: 60, windowMs: 60 * MINUTE },
  transcribeByGuest: { name: 'stt-guest', limit: 10, windowMs: 60 * MINUTE },
  transcribeByIp: { name: 'stt-ip', limit: 30, windowMs: 60 * MINUTE },
  /** Video-generation jobs per signed-in user per day (Phase 9). */
  videoByUser: { name: 'video-user', limit: 5, windowMs: 24 * 60 * MINUTE },
  /** Follow-up suggestions (MODEL-067): per user, per guest session, per guest IP. */
  suggestByUser: { name: 'suggest-user', limit: 120, windowMs: 60 * MINUTE },
  suggestByGuest: { name: 'suggest-guest', limit: 30, windowMs: 60 * MINUTE },
  suggestByIp: { name: 'suggest-ip', limit: 60, windowMs: 60 * MINUTE },
  /** Image-generation jobs per signed-in user per day (Phase 8). */
  imageByUser: { name: 'image-user', limit: 20, windowMs: 24 * 60 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitRules = { [Name in keyof typeof RATE_LIMITS]: RateLimitRule };

export class RateLimiter {
  readonly #store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.#store = store;
  }

  /** @throws AppError RATE_LIMITED with Retry-After when the subject is over the limit. */
  async consume(rule: RateLimitRule, subject: string): Promise<void> {
    const { count, resetInMs } = await this.#store.hitWindow(
      `rate:${rule.name}:${subject}`,
      rule.windowMs,
    );
    if (count > rule.limit) {
      throw new AppError('RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.', {
        retryAfterSeconds: Math.max(1, Math.ceil(resetInMs / 1000)),
      });
    }
  }
}
