import type { ImageGenerationStatus, ImageJobResponse } from '@a-ai/shared-types';
import { imageGenerateRequestSchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';

const idParamsSchema = z.object({ id: z.uuid() });

/** Image generation jobs (docs/api/generation.md). */
export async function imageRoutes(app: FastifyInstance): Promise<void> {
  const { image } = app.services;

  /** Whether image generation is offered, and with which models. Public. */
  app.get('/api/image/status', async (_request, reply): Promise<ImageGenerationStatus> => {
    reply.header('cache-control', 'no-store');
    return image.status();
  });

  app.post('/api/image/generate', async (request, reply): Promise<ImageJobResponse> => {
    const { user } = await requireUser(request, reply);
    const input = imageGenerateRequestSchema.parse(request.body ?? {});
    const response = await image.start(user.id, input);
    reply.status(202).header('cache-control', 'no-store');
    return response;
  });

  app.get('/api/image/:id', async (request, reply): Promise<ImageJobResponse> => {
    const { user } = await requireUser(request, reply);
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) throw new AppError('NOT_FOUND', 'This image job does not exist.');
    reply.header('cache-control', 'no-store');
    return image.get(user.id, params.data.id);
  });
}
