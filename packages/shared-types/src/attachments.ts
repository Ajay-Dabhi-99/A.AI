import type { GenerationJobStatus } from './ai.js';

/** Image attachments and image-generation jobs (Phase 8, docs/api/attachments.md, ADR-015). */

export type AttachmentMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export type Attachment = {
  id: string;
  kind: 'image';
  mimeType: AttachmentMimeType;
  sizeBytes: number;
  width: number;
  height: number;
  /** Display name only; never used as a storage path. */
  fileName: string | null;
  /** `generated` for images made by an image-generation job. */
  source: 'upload' | 'generated';
  createdAt: string;
};

/** What the caller may upload right now (part of GET /api/me). */
export type AttachmentLimits = {
  /** False for guests and when object storage is not configured. */
  enabled: boolean;
  maxBytes: number;
  maxPerMessage: number;
  mimeTypes: AttachmentMimeType[];
};

/** POST /api/attachments */
export type AttachmentUploadResponse = {
  attachment: Attachment;
};

/** GET /api/attachments/:id/url */
export type AttachmentUrlResponse = {
  /** Short-lived signed URL to the private object. */
  url: string;
  expiresAt: string;
};

export type ImageJob = {
  id: string;
  status: GenerationJobStatus;
  provider: string;
  model: string;
  prompt: string;
  errorCode: string | null;
  /** The generated image, once the job completed. */
  attachment: Attachment | null;
  createdAt: string;
  completedAt: string | null;
};

/** GET /api/image/status */
export type ImageGenerationStatus = {
  enabled: boolean;
  models: { provider: string; model: string; name: string }[];
};

/** POST /api/image/generate and GET /api/image/:id */
export type ImageJobResponse = {
  job: ImageJob;
};
