/**
 * Persistence contracts. Services depend on these interfaces; the Prisma
 * implementation talks to Supabase, and tests use an in-memory implementation.
 */

export type UserRoleValue = 'USER' | 'ADMIN';

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  interests: string[];
  interestsSetAt: Date | null;
  instructionsAbout: string | null;
  instructionsStyle: string | null;
  instructionsEnabled: boolean;
  role: UserRoleValue;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: Date;
};

export type AuthTokenType = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

export type AuthTokenRecord = {
  id: string;
  userId: string;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

/** Raised when creating a user whose email already exists (a concurrent signup). */
export class DuplicateEmailError extends Error {
  constructor() {
    super('A user with this email already exists');
    this.name = 'DuplicateEmailError';
  }
}

/** Profile details a user can edit (MODEL-060). Null clears a field. */
export type ProfileFields = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
};

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** @throws DuplicateEmailError */
  create(data: {
    email: string;
    passwordHash: string;
    firstName?: string | null;
    lastName?: string | null;
  }): Promise<UserRecord>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  /** Replaces every profile field and returns the updated user. */
  updateProfile(id: string, profile: ProfileFields): Promise<UserRecord>;
  /** Replaces the user's topics and records when they answered. */
  updateInterests(id: string, interests: string[], at: Date): Promise<UserRecord>;
  /** Replaces the user's personal instructions (MODEL-069). */
  updateInstructions(
    id: string,
    instructions: { about: string | null; style: string | null; enabled: boolean },
  ): Promise<UserRecord>;
  /** Returns the updated user, or null when no account has this email. */
  setRoleByEmail(email: string, role: UserRoleValue): Promise<UserRecord | null>;
  /** Sets emailVerifiedAt if it is not set yet; returns the current user either way. */
  markEmailVerified(id: string, at: Date): Promise<UserRecord>;
}

export interface SessionRepository {
  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipHash: string | null;
  }): Promise<SessionRecord>;
  /** Only sessions that are neither revoked nor expired at `now`. */
  findActiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<(SessionRecord & { user: UserRecord }) | null>;
  touch(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}

export interface AuthTokenRepository {
  create(data: {
    userId: string;
    type: AuthTokenType;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AuthTokenRecord>;
  /**
   * Atomically marks an unused, unexpired token as used and returns it.
   * Two concurrent calls with the same token: exactly one gets the record.
   */
  consume(tokenHash: string, type: AuthTokenType, now: Date): Promise<AuthTokenRecord | null>;
  /** Marks every outstanding token of this type for the user as used. */
  invalidateAll(userId: string, type: AuthTokenType, now: Date): Promise<void>;
}

export type Repositories = {
  users: UserRepository;
  sessions: SessionRepository;
  authTokens: AuthTokenRepository;
};

/** Runs work atomically: every repository call inside commits or none do. */
export type TransactionRunner = <T>(work: (repositories: Repositories) => Promise<T>) => Promise<T>;
