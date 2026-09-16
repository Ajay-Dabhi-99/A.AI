import type { AttachmentLimits } from './attachments.js';

/** Authentication and identity contracts (Phase 1, docs/api/auth.md). */

export type UserRole = 'user' | 'admin';

/** The public view of an account. Never includes password or token data. */
export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  /** Profile details, null until the account sets them (MODEL-060). */
  firstName: string | null;
  lastName: string | null;
  /** Free-form international number; never used for authentication. */
  phone: string | null;
  /** Admins can manage the model registry (Phase 3). */
  role: UserRole;
  createdAt: string;
};

/** Daily allowance for the caller, enforced server-side. */
export type QuotaSummary = {
  limit: number;
  used: number;
  remaining: number;
  /** ISO timestamp of the next reset (midnight UTC). */
  resetsAt: string;
};

/**
 * Who is calling. A guest never learns its internal session id; it only sees
 * when the temporary session ends.
 */
export type Identity = { kind: 'user'; user: AuthUser } | { kind: 'guest'; expiresAt: string };

/** Per-identity limits the UI needs before it sends a request (the API enforces them). */
export type IdentityLimits = {
  /** Most models one comparison may run (Phase 4). */
  compareMaxModels: number;
  /** Image uploads (Phase 8). */
  attachments: AttachmentLimits;
};

/** GET /api/me */
export type MeResponse = {
  identity: Identity;
  quota: QuotaSummary;
  limits: IdentityLimits;
};

/** Login, email verification and password reset all end with a signed-in user. */
export type AuthUserResponse = {
  user: AuthUser;
};

/**
 * Returned by signup, resend-verification and forgot-password whether or not
 * the email exists, so the response cannot be used to discover accounts.
 */
export type AcceptedResponse = {
  status: 'accepted';
};
