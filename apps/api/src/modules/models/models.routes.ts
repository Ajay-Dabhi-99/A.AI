import type {
  ModelCatalogResponse,
  ModelsResponse,
  ModelUpdateResponse,
  ProviderHealthResponse,
} from '@a-ai/shared-types';
import { modelUpdateRequestSchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';

const registryParamsSchema = z.object({ registryId: z.uuid() });

/** Model registry routes (docs/api/models.md). */
export async function modelRoutes(app: FastifyInstance): Promise<void> {
  const { models, health } = app.services;

  /**
   * Provider health from the shared circuit breaker (ADR-013). Public, like the
   * catalog; it reveals error codes only, never provider messages.
   */
  app.get('/api/providers/health', async (_request, reply): Promise<ProviderHealthResponse> => {
    reply.header('cache-control', 'no-store');
    return { providers: await health.snapshot(await models.providers()) };
  });

  /** Models that can be used right now, the default, and provider names. */
  app.get('/api/models', async (_request, reply): Promise<ModelsResponse> => {
    reply.header('cache-control', 'private, max-age=60');
    const available = await models.available();
    const first = available[0];
    return {
      models: available,
      defaultModel: first ? { provider: first.provider, id: first.id } : null,
      providers: await models.providers(),
    };
  });

  /** Every registry entry with its status, for the public /models page. */
  app.get('/api/models/catalog', async (_request, reply): Promise<ModelCatalogResponse> => {
    reply.header('cache-control', 'private, max-age=60');
    return { models: await models.catalog(), providers: await models.providers() };
  });

  app.get('/api/admin/models', async (request, reply): Promise<ModelCatalogResponse> => {
    await requireAdmin(request, reply);
    reply.header('cache-control', 'no-store');
    return { models: await models.catalog(), providers: await models.providers() };
  });

  app.patch(
    '/api/admin/models/:registryId',
    async (request, reply): Promise<ModelUpdateResponse> => {
      const admin = await requireAdmin(request, reply);
      const params = registryParamsSchema.safeParse(request.params);
      if (!params.success) throw new AppError('NOT_FOUND', 'This model does not exist.');
      const changes = modelUpdateRequestSchema.parse(request.body ?? {});

      const model = await models.update(params.data.registryId, changes);

      // Security-relevant change (blueprint §13): who changed which fields, never the values' context.
      request.log.info(
        {
          event: 'model_registry.updated',
          adminUserId: admin.user.id,
          registryId: model.registryId,
          provider: model.provider,
          model: model.id,
          fields: Object.keys(changes),
        },
        'model registry updated',
      );
      reply.header('cache-control', 'no-store');
      return { model };
    },
  );
}
