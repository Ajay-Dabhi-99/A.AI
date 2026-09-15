import type { AuthUser } from '@a-ai/shared-types';
import type { LoginRequest, ResetPasswordRequest, SignupRequest } from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import {
  DuplicateEmailError,
  type Repositories,
  type TransactionRunner,
  type UserRecord,
} from '../../repositories/types.js';
import type { EmailSender } from '../../services/email/email-sender.js';
import {
  accountExistsEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
  type EmailMessage,
} from '../../services/email/templates.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { PasswordHasher } from '../../shared/security/password.js';
import { generateToken, hmac } from '../../shared/security/tokens.js';
import type { IssuedSession, SessionMeta, SessionService } from './session.service.js';

export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export type SignedIn = { user: UserRecord; session: IssuedSession };

export type AuthServiceDeps = {
  repositories: Repositories;
  transaction: TransactionRunner;
  hasher: PasswordHasher;
  sessions: SessionService;
  email: EmailSender;
  secret: string;
  appUrl: string;
  clock: Clock;
  logger: FastifyBaseLogger;
};

const INVALID_CREDENTIALS_MESSAGE = 'Incorrect email or password.';

export function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role === 'ADMIN' ? 'admin' : 'user',
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Account lifecycle (ADR-008). Responses never reveal whether an email is
 * registered: signup, resend and forgot-password behave identically either way.
 */
export class AuthService {
  readonly #deps: AuthServiceDeps;
  #timingHash: Promise<string> | undefined;

  constructor(deps: AuthServiceDeps) {
    this.#deps = deps;
  }

  async signup(input: SignupRequest): Promise<void> {
    const { repositories, hasher, appUrl } = this.#deps;
    // Hash first on every path, so response time does not depend on whether the email exists.
    const passwordHash = await hasher.hash(input.password);
    const existing = await repositories.users.findByEmail(input.email);

    if (existing?.emailVerifiedAt) {
      await this.#deliver(
        accountExistsEmail({
          to: existing.email,
          loginLink: `${appUrl}/login`,
          resetLink: `${appUrl}/forgot-password`,
        }),
      );
      return;
    }

    let user: UserRecord;
    if (existing) {
      // Unverified account: the latest signup's password wins and older links stop working.
      await repositories.users.updatePasswordHash(existing.id, passwordHash);
      user = existing;
    } else {
      try {
        user = await repositories.users.create({ email: input.email, passwordHash });
      } catch (error) {
        if (!(error instanceof DuplicateEmailError)) throw error;
        // A concurrent signup won the race; treat it like an existing unverified account.
        const winner = await repositories.users.findByEmail(input.email);
        if (!winner) throw error;
        user = winner;
      }
    }
    await this.#issueVerification(user);
  }

  async login(input: LoginRequest, meta: SessionMeta): Promise<SignedIn> {
    const { repositories, hasher, sessions } = this.#deps;
    const user = await repositories.users.findByEmail(input.email);

    if (!user) {
      await hasher.verify(await this.#timingEqualizerHash(), input.password);
      throw new AppError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
    }
    if (!(await hasher.verify(user.passwordHash, input.password))) {
      throw new AppError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
    }
    if (!user.emailVerifiedAt) {
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        'Please verify your email address first. Check your inbox or request a new link.',
      );
    }
    return { user, session: await sessions.create(user.id, meta) };
  }

  async verifyEmail(token: string, meta: SessionMeta): Promise<SignedIn> {
    const { transaction, sessions, secret, clock } = this.#deps;
    return transaction(async (repos) => {
      const now = clock.now();
      const record = await repos.authTokens.consume(
        hmac(secret, 'email-link', token),
        'EMAIL_VERIFICATION',
        now,
      );
      if (!record) {
        throw new AppError(
          'TOKEN_INVALID',
          'This verification link is invalid or has expired. Request a new one.',
        );
      }
      const user = await repos.users.markEmailVerified(record.userId, now);
      return { user, session: await sessions.create(user.id, meta, repos.sessions) };
    });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.#deps.repositories.users.findByEmail(email);
    if (user && !user.emailVerifiedAt) await this.#issueVerification(user);
  }

  async forgotPassword(email: string): Promise<void> {
    const { repositories, appUrl } = this.#deps;
    const user = await repositories.users.findByEmail(email);
    if (!user) return;
    const token = await this.#issueToken(user, 'PASSWORD_RESET', RESET_TOKEN_TTL_MS);
    await this.#deliver(
      passwordResetEmail({ to: user.email, link: `${appUrl}/reset-password#token=${token}` }),
    );
  }

  async resetPassword(input: ResetPasswordRequest, meta: SessionMeta): Promise<SignedIn> {
    const { transaction, hasher, sessions, secret, clock, appUrl } = this.#deps;
    const passwordHash = await hasher.hash(input.password);

    const result = await transaction(async (repos) => {
      const now = clock.now();
      const record = await repos.authTokens.consume(
        hmac(secret, 'email-link', input.token),
        'PASSWORD_RESET',
        now,
      );
      if (!record) {
        throw new AppError(
          'TOKEN_INVALID',
          'This reset link is invalid or has expired. Request a new one.',
        );
      }
      await repos.users.updatePasswordHash(record.userId, passwordHash);
      // Opening the emailed link proves control of the inbox.
      const user = await repos.users.markEmailVerified(record.userId, now);
      await repos.sessions.revokeAllForUser(user.id, now);
      await repos.authTokens.invalidateAll(user.id, 'PASSWORD_RESET', now);
      return { user, session: await sessions.create(user.id, meta, repos.sessions) };
    });

    await this.#deliver(
      passwordChangedEmail({ to: result.user.email, resetLink: `${appUrl}/forgot-password` }),
    );
    return result;
  }

  async logout(token: string): Promise<void> {
    await this.#deps.sessions.revokeToken(token);
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.#deps.sessions.revokeAll(userId);
  }

  async #issueVerification(user: UserRecord): Promise<void> {
    const token = await this.#issueToken(user, 'EMAIL_VERIFICATION', VERIFICATION_TOKEN_TTL_MS);
    await this.#deliver(
      verificationEmail({
        to: user.email,
        link: `${this.#deps.appUrl}/verify-email#token=${token}`,
      }),
    );
  }

  /** Replaces any outstanding token of the same type, so only the newest link works. */
  async #issueToken(
    user: UserRecord,
    type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
    ttlMs: number,
  ): Promise<string> {
    const { repositories, secret, clock } = this.#deps;
    const now = clock.now();
    await repositories.authTokens.invalidateAll(user.id, type, now);
    const token = generateToken();
    await repositories.authTokens.create({
      userId: user.id,
      type,
      tokenHash: hmac(secret, 'email-link', token),
      expiresAt: new Date(now.getTime() + ttlMs),
    });
    return token;
  }

  /**
   * Delivery failures are logged, not surfaced: the response must look the same
   * whether or not an email was due, and the user can request another link.
   */
  async #deliver(message: EmailMessage): Promise<void> {
    try {
      await this.#deps.email.send(message);
    } catch (error) {
      this.#deps.logger.error(
        {
          errorName: (error as Error)?.name,
          errorMessage: (error as Error)?.message,
          subject: message.subject,
        },
        'email delivery failed',
      );
    }
  }

  #timingEqualizerHash(): Promise<string> {
    this.#timingHash ??= this.#deps.hasher.hash('timing-equalizer-for-unknown-accounts');
    return this.#timingHash;
  }
}
