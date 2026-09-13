import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ServerEnv } from '@a-ai/config/server';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { toApiError } from '../shared/errors/to-api-error.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Accepts an upstream correlation id (from Vercel, a load balancer or the web
 * app) only when it is a plain token; anything else is replaced so log lines
 * cannot be forged or bloated through the header.
 */
export function resolveRequestId(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && SAFE_REQUEST_ID.test(value) ? value : randomUUID();
}

export function genReqId(request: IncomingMessage): string {
  return resolveRequestId(request.headers['x-request-id']);
}

export function loggerOptions(env: ServerEnv): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}

/**
 * Request correlation, one structured completion log per request (blueprint
 * §14 minimum fields that exist in Phase 0), and the global error envelope.
 */
export function registerObservability(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        statusCode: reply.statusCode,
        latencyMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = toApiError(error, request.id);
    if (normalized.unexpected) {
      request.log.error({ err: error }, 'unhandled error');
    } else {
      request.log.info({ errorCode: normalized.body.error.code }, 'request rejected');
    }
    return reply.status(normalized.statusCode).headers(normalized.headers).send(normalized.body);
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url.split('?')[0]} does not exist.`,
        retryable: false,
        requestId: request.id,
      },
    });
  });
}
