import type { AudioStatus, TranscriptionResponse } from '@a-ai/shared-types';
import { transcriptionQuerySchema } from '@a-ai/validation';
import type { FastifyInstance } from 'fastify';
import { hashedIp, resolveIdentity } from '../../plugins/auth.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { TranscriptionSubject } from './transcription.service.js';

/** Speech-to-text (docs/api/audio.md). Guests and users; text-to-speech runs in the browser. */
export async function audioRoutes(app: FastifyInstance): Promise<void> {
  const { transcription } = app.services;
  const maxBytes = app.env.AUDIO_MAX_BYTES;

  app.get('/api/audio/status', async (_request, reply): Promise<AudioStatus> => {
    reply.header('cache-control', 'no-store');
    return transcription.status();
  });

  app.post('/api/audio/transcriptions', async (request, reply): Promise<TranscriptionResponse> => {
    const { language } = transcriptionQuerySchema.parse(request.query ?? {});
    const identity = await resolveIdentity(request, reply, { createGuest: true });
    const subject: TranscriptionSubject =
      identity.kind === 'user'
        ? { kind: 'user', userId: identity.user.id }
        : { kind: 'guest', guestId: identity.guest.id, ipHash: hashedIp(request) };

    // Provider configured and caller under the limits before a single byte is read.
    await transcription.begin(subject);
    if (!request.isMultipart()) {
      throw new AppError('VALIDATION_ERROR', 'Send the recording as multipart/form-data.', {
        statusCode: 415,
      });
    }
    const file = await request.file({
      limits: { fileSize: maxBytes, files: 1, fields: 0, parts: 1 },
    });
    if (!file) throw new AppError('VALIDATION_ERROR', 'Record something first.');
    const bytes = await file.toBuffer();

    // A client that goes away stops the provider call.
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) {
        controller.abort(new DOMException('The client disconnected', 'AbortError'));
      }
    });

    reply.header('cache-control', 'no-store');
    return transcription.transcribe(subject, {
      bytes,
      declaredType: file.mimetype,
      ...(language ? { language } : {}),
      signal: controller.signal,
    });
  });
}
