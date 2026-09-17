import type { FastifyBaseLogger } from 'fastify';
import { vi } from 'vitest';
import type { ChatServiceDeps } from '../../src/modules/chat/chat.service.js';
import type { EmailSender } from '../../src/services/email/email-sender.js';
import type { EmailMessage } from '../../src/services/email/templates.js';
import type { Clock } from '../../src/shared/clock.js';
import type { PasswordHasher } from '../../src/shared/security/password.js';

/** Records emails instead of sending them; can simulate one delivery failure. */
export class CapturingEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];
  failNext = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated delivery failure');
    }
    this.messages.push(message);
  }

  lastTo(email: string): EmailMessage | undefined {
    return this.messages.filter((message) => message.to === email).at(-1);
  }

  /** The token from a `#token=` link in the most recent email to this address. */
  tokenFor(email: string): string {
    const match = this.lastTo(email)?.text.match(/#token=([A-Za-z0-9_-]+)/);
    if (!match?.[1]) throw new Error(`no link token emailed to ${email}`);
    return match[1];
  }
}

/** A clock tests move by hand. */
export class TestClock implements Clock {
  #current: number;

  constructor(start = '2026-09-13T10:00:00.000Z') {
    this.#current = Date.parse(start);
  }

  now(): Date {
    return new Date(this.#current);
  }

  advance(ms: number): void {
    this.#current += ms;
  }
}

/** Deterministic, instant hasher for service unit tests (argon2 has its own tests). */
export const fakeHasher: PasswordHasher = {
  hash: async (password) => `fake-hash:${password}`,
  verify: async (passwordHash, password) => passwordHash === `fake-hash:${password}`,
};

/** Chat without images: services that never see attachment ids. */
export const noAttachments: ChatServiceDeps['attachments'] = {
  prepareForMessage: async () => ({ attachments: [], images: [] }),
  attach: async () => undefined,
  forMessages: async () => new Map(),
};

export function silentLogger(): FastifyBaseLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const logger = {
    level: 'silent',
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: () => logger,
  };
  return logger as unknown as ReturnType<typeof silentLogger>;
}
