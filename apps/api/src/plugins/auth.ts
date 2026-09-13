import type { ServerEnv } from '@a-ai/config/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GuestSession } from '../modules/guest/guest.service.js';
import type { SessionMeta } from '../modules/auth/session.service.js';
import type { UserRecord } from '../repositories/types.js';
import type { AppServices } from '../services/container.js';
import { AppError } from '../shared/errors/app-error.js';
import { clearCookie, setCookie, type CookieNames } from '../shared/http/cookies.js';
import { hmac } from '../shared/security/tokens.js';

declare module 'fastify' {
  interface FastifyInstance {
    env: ServerEnv;
    services: AppServices;
    cookieNames: CookieNames;
  }
}

export type UserIdentity = { kind: 'user'; user: UserRecord; sessionId: string };
export type GuestIdentity = { kind: 'guest'; guest: GuestSession };
export type ResolvedIdentity = UserIdentity | GuestIdentity | { kind: 'anonymous' };

export function hashedIp(request: FastifyRequest): string {
  return hmac(request.server.services.secret, 'ip', request.ip);
}

export function sessionMeta(request: FastifyRequest): SessionMeta {
  const userAgent = request.headers['user-agent'];
  return {
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    ipHash: hashedIp(request),
  };
}

/**
 * The identity resolver (blueprint §4): a valid session cookie means a user, a
 * valid guest cookie means a guest. Invalid or expired cookies are cleared.
 * With `createGuest`, a caller with neither gets a new guest session.
 */
export function resolveIdentity(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { createGuest: true },
): Promise<UserIdentity | GuestIdentity>;
export function resolveIdentity(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { createGuest: false },
): Promise<ResolvedIdentity>;
export async function resolveIdentity(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { createGuest: boolean },
): Promise<ResolvedIdentity> {
  const { env, services, cookieNames } = request.server;

  const sessionToken = request.cookies[cookieNames.session];
  if (sessionToken) {
    const resolved = await services.sessions.resolve(sessionToken);
    if (resolved) {
      if (resolved.refreshed) {
        setCookie(reply, env, cookieNames.session, sessionToken, resolved.expiresAt);
      }
      return { kind: 'user', user: resolved.user, sessionId: resolved.sessionId };
    }
    clearCookie(reply, env, cookieNames.session);
  }

  const guestId = request.cookies[cookieNames.guest];
  if (guestId) {
    const guest = await services.guests.find(guestId);
    if (guest) return { kind: 'guest', guest };
    clearCookie(reply, env, cookieNames.guest);
  }

  if (!options.createGuest) return { kind: 'anonymous' };

  const guest = await services.guests.create();
  setCookie(reply, env, cookieNames.guest, guest.id, new Date(guest.expiresAt));
  return { kind: 'guest', guest };
}

/** @throws AppError AUTH_REQUIRED unless the caller has a valid user session. */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<UserIdentity> {
  const identity = await resolveIdentity(request, reply, { createGuest: false });
  if (identity.kind !== 'user') {
    throw new AppError('AUTH_REQUIRED', 'Please sign in to continue.');
  }
  return identity;
}
