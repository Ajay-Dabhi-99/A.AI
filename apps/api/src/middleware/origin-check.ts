import type { ServerEnv } from '@a-ai/config/server';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../shared/errors/app-error.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence in depth (ADR-008). Session cookies are SameSite=Lax; on top of
 * that, a browser request that changes state must come from an allowed origin.
 * Browsers always send Origin on cross-site POSTs; requests without it are
 * non-browser clients, which cannot carry a victim's cookies.
 */
export function registerOriginCheck(app: FastifyInstance, env: ServerEnv): void {
  app.addHook('onRequest', async (request) => {
    if (!STATE_CHANGING.has(request.method) || !request.url.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (origin === undefined) return;
    if (!env.CORS_ORIGIN.includes(origin)) {
      throw new AppError(
        'FORBIDDEN',
        'This request came from a site that is not allowed to make changes.',
      );
    }
  });
}
