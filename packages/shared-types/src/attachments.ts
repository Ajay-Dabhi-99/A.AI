import type { MediaGenerationStatus, MediaJob, MediaJobResponse } from './media.js';

/** Attachments: uploaded images and generated media (Phases 8–9, docs/api/attachments.md). */

export type AttachmentMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
export type VideoAttachmentMimeType = 'video/mp4' | 'video/webm';

export type Attachment = {
  id: string;
  kind: 'image' | 'video';
  mimeType: AttachmentMimeType | VideoAttachmentMimeType;
  sizeBytes: number;
  /** Pixel size for images; null for videos (their headers are not parsed). */
  width: number | null;
  height: number | null;
  /** Display name only; never used as a storage path. */
  fileName: string | null;
  /** `generated` for files made by a generation job. */
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

/** Phase 8 names for the image routes; the shapes are the shared media job contract. */
export type ImageJob = MediaJob;
export type ImageGenerationStatus = MediaGenerationStatus;
export type ImageJobResponse = MediaJobResponse;
