import type { ServerEnv } from '@a-ai/config/server';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailMessage } from './templates.js';

export interface EmailSender {
  /** @throws when the provider rejects or cannot be reached */
  send(message: EmailMessage): Promise<void>;
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Resend over its REST API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailSender implements EmailSender {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: {
    apiKey: string;
    from: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.#fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.#from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      // The body can echo request data; never propagate it.
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Resend returned HTTP ${response.status}`);
    }
  }
}

/**
 * Development and test only (the env schema requires RESEND_API_KEY in
 * production): writes the email, including its link, to the API log so the
 * verification and reset flows can be completed locally.
 */
export class LogEmailSender implements EmailSender {
  readonly #logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    this.#logger = logger;
  }

  async send(message: EmailMessage): Promise<void> {
    this.#logger.info(
      { emailTo: message.to, subject: message.subject, body: message.text },
      'email not sent: RESEND_API_KEY is not set, contents logged for development',
    );
  }
}

export function createEmailSender(env: ServerEnv, logger: FastifyBaseLogger): EmailSender {
  return env.RESEND_API_KEY
    ? new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
    : new LogEmailSender(logger);
}
