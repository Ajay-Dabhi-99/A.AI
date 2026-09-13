import type { ServerEnv } from '@a-ai/config/server';
import type { HealthResponse } from '@a-ai/shared-types';
import type { FastifyInstance } from 'fastify';
import { APP_VERSION, SERVICE_NAME } from '../../shared/constants/app.js';
import { checkReadiness } from './health.service.js';

export async function healthRoutes(
  app: FastifyInstance,
  options: { env: ServerEnv },
): Promise<void> {
  /** Liveness: the process is up and serving. Never touches dependencies. */
  app.get('/health', async (_request, reply): Promise<HealthResponse> => {
    reply.header('cache-control', 'no-store');
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  /** Readiness: Supabase, Upstash and provider configuration (blueprint v4 §14). */
  app.get('/ready', async (request, reply) => {
    const report = await checkReadiness(app, options.env, request.log);
    return reply
      .status(report.status === 'ready' ? 200 : 503)
      .header('cache-control', 'no-store')
      .send(report);
  });
}
