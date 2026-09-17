import type { AuthUserResponse, MeResponse } from '@a-ai/shared-types';
import { interestsUpdateSchema, profileUpdateSchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { requireUser, resolveIdentity } from '../../plugins/auth.js';
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

  /** Update the signed-in account's profile. Names are required; a blank phone clears it. */
  app.patch('/api/me/profile', async (request, reply): Promise<AuthUserResponse> => {
    const identity = await requireUser(request, reply);
    const input = profileUpdateSchema.parse(request.body ?? {});
    const user = await app.services.profile.update(identity.user.id, input);
    return { user: toAuthUser(user) };
  });

  /** Replace the signed-in account's chat topics (MODEL-066). */
  app.patch('/api/me/interests', async (request, reply): Promise<AuthUserResponse> => {
    const identity = await requireUser(request, reply);
    const input = interestsUpdateSchema.parse(request.body ?? {});
    const user = await app.services.profile.updateInterests(identity.user.id, input);
    reply.header('cache-control', 'no-store');
    return { user: toAuthUser(user) };
  });
}
