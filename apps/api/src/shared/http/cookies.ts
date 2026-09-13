import type { ServerEnv } from '@a-ai/config/server';
import type { FastifyReply } from 'fastify';

export type CookieNames = {
  session: string;
  guest: string;
};

/**
 * In production the `__Host-` prefix makes browsers reject the cookie unless it
 * is Secure, host-only and path=/, so a sibling subdomain cannot overwrite it.
 * Local development runs on plain http, where that prefix is not allowed.
 */
export function cookieNames(env: ServerEnv): CookieNames {
  const hostPrefix = env.NODE_ENV === 'production' ? '__Host-' : '';
  return { session: `${hostPrefix}a_ai_session`, guest: `${hostPrefix}a_ai_guest` };
}

function baseOptions(env: ServerEnv) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function setCookie(
  reply: FastifyReply,
  env: ServerEnv,
  name: string,
  value: string,
  expiresAt: Date,
): void {
  reply.setCookie(name, value, { ...baseOptions(env), expires: expiresAt });
}

export function clearCookie(reply: FastifyReply, env: ServerEnv, name: string): void {
  reply.clearCookie(name, baseOptions(env));
}
