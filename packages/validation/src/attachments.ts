import type {
  Attachment,
  AttachmentLimits,
  AttachmentMimeType,
  AttachmentUploadResponse,
  AttachmentUrlResponse,
  ImageGenerationStatus,
  ImageJob,
  ImageJobResponse,
} from '@a-ai/shared-types';
import { z } from 'zod';

export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const satisfies readonly AttachmentMimeType[];
export const ATTACHMENTS_PER_MESSAGE_MAX = 4;
export const IMAGE_MAX_DIMENSION = 8_192;
export const IMAGE_PROMPT_MAX_LENGTH = 2_000;

export const attachmentSchema = z.object({
  id: z.string(),
  kind: z.literal('image'),
  mimeType: z.enum(ATTACHMENT_MIME_TYPES),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
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

/** POST /api/image/generate */
export const imageGenerateRequestSchema = z
  .object({
    provider: z.string().min(1).max(32),
    model: z.string().min(1).max(128),
    prompt: z
      .string()
      .trim()
      .min(1, 'Describe the image first')
      .max(IMAGE_PROMPT_MAX_LENGTH, `Prompts can be at most ${IMAGE_PROMPT_MAX_LENGTH} characters`),
  })
  .strict();

export type ImageGenerateRequest = z.infer<typeof imageGenerateRequestSchema>;

export const imageJobSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']),
  provider: z.string(),
  model: z.string(),
  prompt: z.string(),
  errorCode: z.string().nullable(),
  attachment: attachmentSchema.nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
}) satisfies z.ZodType<ImageJob>;

export const imageJobResponseSchema = z.object({
  job: imageJobSchema,
}) satisfies z.ZodType<ImageJobResponse>;

export const imageGenerationStatusSchema = z.object({
  enabled: z.boolean(),
  models: z.array(z.object({ provider: z.string(), model: z.string(), name: z.string() })),
}) satisfies z.ZodType<ImageGenerationStatus>;
