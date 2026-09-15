import type { AttachmentUploadResponse, AttachmentUrlResponse } from '@a-ai/shared-types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';

const idParamsSchema = z.object({ id: z.uuid() });
const NOT_FOUND = 'This image does not exist.';

/** Image uploads and signed URLs (docs/api/attachments.md). Signed-in users only. */
export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  const { attachments } = app.services;
  const maxBytes = app.env.ATTACHMENT_MAX_BYTES;

  app.post('/api/attachments', async (request, reply): Promise<AttachmentUploadResponse> => {
    const { user } = await requireUser(request, reply);
    // Storage and rate limit are checked before a single upload byte is read.
    await attachments.beginUpload(user.id);
    if (!request.isMultipart()) {
      throw new AppError('VALIDATION_ERROR', 'Send the image as multipart/form-data.', {
        statusCode: 415,
      });
    }

    // One file part, no other fields; the size limit cuts the stream as soon as it is exceeded.
    const file = await request.file({
      limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 },
    });
    if (!file) throw new AppError('VALIDATION_ERROR', 'Choose an image to upload.');
    const bytes = await file.toBuffer();

    const attachment = await attachments.upload(user.id, {
      bytes,
      declaredType: file.mimetype,
      fileName: file.filename,
    });
    reply.status(201).header('cache-control', 'no-store');
    return { attachment };
  });

  /** A short-lived signed URL to the owner's private image. */
  app.get('/api/attachments/:id/url', async (request, reply): Promise<AttachmentUrlResponse> => {
    const { user } = await requireUser(request, reply);
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) throw new AppError('NOT_FOUND', NOT_FOUND);
    reply.header('cache-control', 'no-store');
    return attachments.signedUrl(user.id, params.data.id);
  });
}
