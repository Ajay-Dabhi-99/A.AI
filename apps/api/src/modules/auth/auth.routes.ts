import type { AcceptedResponse, AuthUserResponse } from '@a-ai/shared-types';
import {
  emailRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
  verifyEmailRequestSchema,
} from '@a-ai/validation';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { hashedIp, requireUser, sessionMeta } from '../../plugins/auth.js';
import { clearCookie, setCookie } from '../../shared/http/cookies.js';
import { hmac } from '../../shared/security/tokens.js';
import { toAuthUser, type SignedIn } from './auth.service.js';

const ACCEPTED: AcceptedResponse = { status: 'accepted' };

/** Routes under /api/auth. Thin: rate-limit, validate, call AuthService, map the response. */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { env, cookieNames } = app;
  const { auth, rateLimiter, rateLimits, secret } = app.services;

  const emailKey = (email: string) => hmac(secret, 'email-address', email);

  const signIn = (reply: FastifyReply, result: SignedIn): AuthUserResponse => {
    setCookie(reply, env, cookieNames.session, result.session.token, result.session.expiresAt);
    return { user: toAuthUser(result.user) };
  };

  app.post('/signup', async (request, reply) => {
    await rateLimiter.consume(rateLimits.signupByIp, hashedIp(request));
    const input = signupRequestSchema.parse(request.body ?? {});
    await rateLimiter.consume(rateLimits.emailByAddress, emailKey(input.email));
    await auth.signup(input);
    return reply.status(202).send(ACCEPTED);
  });

  app.post('/login', async (request, reply) => {
    await rateLimiter.consume(rateLimits.loginByIp, hashedIp(request));
    const input = loginRequestSchema.parse(request.body ?? {});
    await rateLimiter.consume(rateLimits.loginByEmail, emailKey(input.email));
    return signIn(reply, await auth.login(input, sessionMeta(request)));
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[cookieNames.session];
    if (token) await auth.logout(token);
    clearCookie(reply, env, cookieNames.session);
    return reply.status(204).send();
  });

  app.post('/logout-all', async (request, reply) => {
    const identity = await requireUser(request, reply);
    await auth.logoutEverywhere(identity.user.id);
    clearCookie(reply, env, cookieNames.session);
    return reply.status(204).send();
  });

  app.post('/verify-email', async (request, reply) => {
    await rateLimiter.consume(rateLimits.linkByIp, hashedIp(request));
    const { token } = verifyEmailRequestSchema.parse(request.body ?? {});
    return signIn(reply, await auth.verifyEmail(token, sessionMeta(request)));
  });

  app.post('/resend-verification', async (request, reply) => {
    await rateLimiter.consume(rateLimits.emailByIp, hashedIp(request));
    const { email } = emailRequestSchema.parse(request.body ?? {});
    await rateLimiter.consume(rateLimits.emailByAddress, emailKey(email));
    await auth.resendVerification(email);
    return reply.status(202).send(ACCEPTED);
  });

  app.post('/forgot-password', async (request, reply) => {
    await rateLimiter.consume(rateLimits.emailByIp, hashedIp(request));
    const { email } = emailRequestSchema.parse(request.body ?? {});
    await rateLimiter.consume(rateLimits.emailByAddress, emailKey(email));
    await auth.forgotPassword(email);
    return reply.status(202).send(ACCEPTED);
  });

  app.post('/reset-password', async (request, reply) => {
    await rateLimiter.consume(rateLimits.linkByIp, hashedIp(request));
    const input = resetPasswordRequestSchema.parse(request.body ?? {});
    return signIn(reply, await auth.resetPassword(input, sessionMeta(request)));
  });
}
