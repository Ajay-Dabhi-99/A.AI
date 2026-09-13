import type { FastifyInstance } from 'fastify';
import { hashedIp } from '../plugins/auth.js';

/** Baseline per-IP limit for every /api route (health and readiness are exempt). */
export function registerApiRateLimit(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const { rateLimiter, rateLimits } = app.services;
    await rateLimiter.consume(rateLimits.api, hashedIp(request));
  });
}
