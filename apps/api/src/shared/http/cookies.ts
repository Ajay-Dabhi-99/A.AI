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

const COOKIE_NAME = /^[A-Za-z0-9_-]+$/;
const COOKIE_VALUE = /^[A-Za-z0-9_-]*$/;

/**
 * Serializes a cookie and adds it as a Set-Cookie header on the reply itself.
 * Writing the header directly (instead of @fastify/cookie's onSend hook) keeps
 * cookies on streamed responses, which bypass Fastify's send pipeline.
 * Names and values are restricted to token characters, so no encoding is needed.
 */
function appendSetCookie(
  reply: FastifyReply,
  env: ServerEnv,
  name: string,
  value: string,
  expiresAt: Date,
  maxAgeSeconds?: number,
): void {
  if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value)) {
    throw new Error(`Refusing to set cookie ${name}: unexpected characters`);
  }
  const parts = [
    `${name}=${value}`,
    'Path=/',
    `Expires=${expiresAt.toUTCString()}`,
    ...(maxAgeSeconds === undefined ? [] : [`Max-Age=${maxAgeSeconds}`]),
    'HttpOnly',
    'SameSite=Lax',
    ...(env.NODE_ENV === 'production' ? ['Secure'] : []),
  ];
  // One header per cookie name: a later set (e.g. clear then re-issue) replaces the earlier one.
  const existing = reply.getHeader('set-cookie');
  const others = (
    Array.isArray(existing) ? existing : existing === undefined ? [] : [String(existing)]
  ).filter((header) => !header.startsWith(`${name}=`));
  reply.removeHeader('set-cookie');
  reply.header('set-cookie', [...others, parts.join('; ')]);
}

export function setCookie(
  reply: FastifyReply,
  env: ServerEnv,
  name: string,
  value: string,
  expiresAt: Date,
): void {
  appendSetCookie(reply, env, name, value, expiresAt);
}

export function clearCookie(reply: FastifyReply, env: ServerEnv, name: string): void {
  appendSetCookie(reply, env, name, '', new Date(0), 0);
}
