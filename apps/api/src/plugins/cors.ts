import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { ServerEnv } from '@a-ai/config/server';
import type { FastifyInstance } from 'fastify';

/**
 * Browser-facing security: exact-origin CORS with credentials (cookies carry
 * guest and user sessions from Phase 1) and standard security headers.
 */
export async function registerCorsAndSecurity(app: FastifyInstance, env: ServerEnv): Promise<void> {
  await app.register(helmet, {
    // JSON API: nothing is rendered, so lock the policy down completely.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });
}
