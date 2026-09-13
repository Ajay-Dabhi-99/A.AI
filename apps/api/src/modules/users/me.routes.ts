import type { MeResponse } from '@a-ai/shared-types';
import type { FastifyInstance } from 'fastify';
import { resolveIdentity } from '../../plugins/auth.js';
import { toAuthUser } from '../auth/auth.service.js';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  /** Current identity and daily quota. Issues a guest session to first-time visitors. */
  app.get('/api/me', async (request, reply): Promise<MeResponse> => {
    const identity = await resolveIdentity(request, reply, { createGuest: true });
    reply.header('cache-control', 'no-store');

    if (identity.kind === 'user') {
      return {
        identity: { kind: 'user', user: toAuthUser(identity.user) },
        quota: await app.services.quota.summary({ kind: 'user', id: identity.user.id }),
      };
    }
    return {
      identity: { kind: 'guest', expiresAt: identity.guest.expiresAt },
      quota: await app.services.quota.summary({ kind: 'guest', id: identity.guest.id }),
    };
  });
}
