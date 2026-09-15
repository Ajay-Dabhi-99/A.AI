import type { AttachmentUploadResponse, AttachmentUrlResponse } from '@a-ai/shared-types';
import { attachmentUploadResponseSchema, attachmentUrlResponseSchema } from '@a-ai/validation';
import { apiRequest, apiUpload } from './api';

/** POST /api/attachments: one image as multipart/form-data (docs/api/attachments.md). */
export function uploadAttachment(
  file: File,
  signal?: AbortSignal,
): Promise<AttachmentUploadResponse> {
  const form = new FormData();
  form.append('file', file, file.name);
  return apiUpload('/api/attachments', form, {
    schema: attachmentUploadResponseSchema,
    ...(signal ? { signal } : {}),
  });
}

/** A short-lived signed URL for one of the user's images. */
export const fetchAttachmentUrl = (
  id: string,
  signal?: AbortSignal,
): Promise<AttachmentUrlResponse> =>
  apiRequest(`/api/attachments/${encodeURIComponent(id)}/url`, {
    schema: attachmentUrlResponseSchema,
    ...(signal ? { signal } : {}),
  });
