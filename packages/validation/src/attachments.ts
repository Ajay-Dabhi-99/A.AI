import type {
  Attachment,
  AttachmentLimits,
  AttachmentMimeType,
  AttachmentUploadResponse,
  AttachmentUrlResponse,
  JobStreamEvent,
  MediaGenerationStatus,
  MediaJob,
  MediaJobListResponse,
  MediaJobResponse,
  VideoAttachmentMimeType,
} from '@a-ai/shared-types';
import { z } from 'zod';

export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const satisfies readonly AttachmentMimeType[];
export const VIDEO_ATTACHMENT_MIME_TYPES = [
  'video/mp4',
  'video/webm',
] as const satisfies readonly VideoAttachmentMimeType[];
export const ATTACHMENTS_PER_MESSAGE_MAX = 4;
export const IMAGE_MAX_DIMENSION = 8_192;
export const IMAGE_PROMPT_MAX_LENGTH = 2_000;
export const MEDIA_PROMPT_MAX_LENGTH = IMAGE_PROMPT_MAX_LENGTH;
export const MEDIA_JOB_KINDS = ['image', 'video'] as const;

export const attachmentSchema = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video']),
  mimeType: z.enum([...ATTACHMENT_MIME_TYPES, ...VIDEO_ATTACHMENT_MIME_TYPES]),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fileName: z.string().nullable(),
  source: z.enum(['upload', 'generated']),
  createdAt: z.string(),
}) satisfies z.ZodType<Attachment>;

export const attachmentLimitsSchema = z.object({
  enabled: z.boolean(),
  maxBytes: z.number().int().nonnegative(),
  maxPerMessage: z.number().int().nonnegative(),
  mimeTypes: z.array(z.enum(ATTACHMENT_MIME_TYPES)),
}) satisfies z.ZodType<AttachmentLimits>;

export const attachmentUploadResponseSchema = z.object({
  attachment: attachmentSchema,
}) satisfies z.ZodType<AttachmentUploadResponse>;

export const attachmentUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.string(),
}) satisfies z.ZodType<AttachmentUrlResponse>;

/** POST /api/image/generate and POST /api/video/generate */
export const mediaGenerateRequestSchema = z
  .object({
    provider: z.string().min(1).max(32),
    model: z.string().min(1).max(128),
    prompt: z
      .string()
      .trim()
      .min(1, 'Describe what to generate first')
      .max(MEDIA_PROMPT_MAX_LENGTH, `Prompts can be at most ${MEDIA_PROMPT_MAX_LENGTH} characters`),
  })
  .strict();

export type MediaGenerateRequest = z.infer<typeof mediaGenerateRequestSchema>;
export const imageGenerateRequestSchema = mediaGenerateRequestSchema;
export type ImageGenerateRequest = MediaGenerateRequest;

export const mediaJobSchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_JOB_KINDS),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']),
  provider: z.string(),
  model: z.string(),
  prompt: z.string(),
  progress: z.number().min(0).max(1).nullable(),
  errorCode: z.string().nullable(),
  attachment: attachmentSchema.nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
}) satisfies z.ZodType<MediaJob>;

export const mediaJobResponseSchema = z.object({
  job: mediaJobSchema,
}) satisfies z.ZodType<MediaJobResponse>;

export const mediaJobListResponseSchema = z.object({
  jobs: z.array(mediaJobSchema),
}) satisfies z.ZodType<MediaJobListResponse>;

export const mediaGenerationStatusSchema = z.object({
  enabled: z.boolean(),
  models: z.array(z.object({ provider: z.string(), model: z.string(), name: z.string() })),
}) satisfies z.ZodType<MediaGenerationStatus>;

/** Phase 8 names. */
export const imageJobSchema = mediaJobSchema;
export const imageJobResponseSchema = mediaJobResponseSchema;
export const imageGenerationStatusSchema = mediaGenerationStatusSchema;

/** GET /api/jobs */
export const jobListQuerySchema = z.object({
  kind: z.enum(MEDIA_JOB_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type JobListQuery = z.infer<typeof jobListQuerySchema>;

/** Parses one event from GET /api/jobs/:id/events; null for anything unexpected. */
export function parseJobStreamEvent(event: string, data: string): JobStreamEvent | null {
  if (event !== 'job') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = mediaJobSchema.safeParse(json);
  return parsed.success ? { event: 'job', data: parsed.data } : null;
}
