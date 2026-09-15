import type { MeResponse } from '@a-ai/shared-types';
import type { FastifyInstance } from 'fastify';
import { resolveIdentity } from '../../plugins/auth.js';
import { toAuthUser } from '../auth/auth.service.js';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  /** Current identity, daily quota and limits. Issues a guest session to first-time visitors. */
  app.get('/api/me', async (request, reply): Promise<MeResponse> => {
    const identity = await resolveIdentity(request, reply, { createGuest: true });
    const { quota, comparison, attachments } = app.services;
    reply.header('cache-control', 'no-store');

    if (identity.kind === 'user') {
      return {
        identity: { kind: 'user', user: toAuthUser(identity.user) },
        quota: await quota.summary({ kind: 'user', id: identity.user.id }),
        limits: {
          compareMaxModels: comparison.maxModels('user'),
          attachments: attachments.limits('user'),
        },
      };
    }
    return {
      identity: { kind: 'guest', expiresAt: identity.guest.expiresAt },
      quota: await quota.summary({ kind: 'guest', id: identity.guest.id }),
      limits: {
        compareMaxModels: comparison.maxModels('guest'),
        attachments: attachments.limits('guest'),
      },
    };
  });
}
