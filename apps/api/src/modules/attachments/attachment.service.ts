import { createHash, randomUUID } from 'node:crypto';
import type {
  AIImageInput,
  AIModel,
  Attachment,
  AttachmentLimits,
  AttachmentUrlResponse,
} from '@a-ai/shared-types';
import {
  ATTACHMENT_MIME_TYPES,
  ATTACHMENTS_PER_MESSAGE_MAX,
  IMAGE_MAX_DIMENSION,
} from '@a-ai/validation';
import type { FastifyBaseLogger } from 'fastify';
import { sniffImage, stripImageMetadata } from '../../ai/image-sniff.js';
import { sniffVideo } from '../../ai/media-sniff.js';
import type {
  AttachmentKindValue,
  AttachmentRecord,
  AttachmentRepository,
  AttachmentSourceValue,
} from '../../repositories/attachment.repository.js';
import type { RateLimiter, RateLimitRule } from '../../services/rate-limit.service.js';
import type { ObjectStorage } from '../../services/storage/object-storage.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';

/** Signed URLs are short-lived: long enough to render, too short to be worth sharing. */
export const SIGNED_URL_TTL_SECONDS = 300;
/** Uploads not sent with a message within this time are removed by the cleanup job. */
export const UNATTACHED_TTL_MS = 24 * 60 * 60 * 1000;
export const FILE_NAME_MAX_LENGTH = 120;
/** Generated videos when no explicit limit is configured. */
export const DEFAULT_VIDEO_MAX_BYTES = 52_428_800;

export type AttachmentServiceDeps = {
  repository: AttachmentRepository;
  storage: ObjectStorage;
  rateLimiter: RateLimiter;
  uploadRule: RateLimitRule;
  maxBytes: number;
  /** Largest generated video stored (Phase 9). */
  videoMaxBytes?: number;
  clock: Clock;
  logger: FastifyBaseLogger;
};

export function toAttachment(record: AttachmentRecord): Attachment {
  return {
    id: record.id,
    kind: record.kind === 'video' ? 'video' : 'image',
    mimeType: record.mimeType as Attachment['mimeType'],
    sizeBytes: record.sizeBytes,
    width: record.width,
    height: record.height,
    fileName: record.fileName,
    source: record.source === 'generated' ? 'generated' : 'upload',
    createdAt: record.createdAt.toISOString(),
  };
}

/** Display text only: control characters and path separators removed, length capped. */
export function cleanFileName(name: string | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).at(-1) ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.length > FILE_NAME_MAX_LENGTH ? cleaned.slice(0, FILE_NAME_MAX_LENGTH) : cleaned;
}

/** Browsers and tools disagree on JPEG's name; everything else must match exactly. */
function normalizeDeclaredType(type: string): string {
  const value = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return value === 'image/jpg' || value === 'image/pjpeg' ? 'image/jpeg' : value;
}

const megabytes = (bytes: number) => Math.floor(bytes / 1_048_576);

const unsupported = () =>
  new AppError('VALIDATION_ERROR', 'Only PNG, JPEG, WebP and GIF images are supported.', {
    statusCode: 415,
  });

/**
 * Attachments (blueprint §16 Phases 8–9, ADR-015, ADR-016): every byte is
 * validated, image metadata is stripped before storage, objects stay private
 * behind signed URLs, and files are only ever read by their owner or sent to
 * a vision model.
 */
export class AttachmentService {
  readonly #deps: AttachmentServiceDeps;

  constructor(deps: AttachmentServiceDeps) {
    this.#deps = deps;
  }

  get enabled(): boolean {
    return this.#deps.storage.enabled;
  }

  limits(kind: 'user' | 'guest'): AttachmentLimits {
    return {
      enabled: kind === 'user' && this.enabled,
      maxBytes: this.#deps.maxBytes,
      maxPerMessage: ATTACHMENTS_PER_MESSAGE_MAX,
      mimeTypes: [...ATTACHMENT_MIME_TYPES],
    };
  }

  /**
   * Checks before the upload body is read: storage configured, caller under the
   * rate limit. @throws AppError MODEL_UNAVAILABLE or RATE_LIMITED
   */
  async beginUpload(userId: string): Promise<void> {
    this.#assertEnabled();
    await this.#deps.rateLimiter.consume(this.#deps.uploadRule, `user:${userId}`);
  }

  async upload(
    userId: string,
    input: { bytes: Uint8Array; declaredType: string; fileName?: string },
  ): Promise<Attachment> {
    this.#assertEnabled();
    const record = await this.#storeImage(userId, input.bytes, {
      source: 'upload',
      declaredType: input.declaredType,
      fileName: cleanFileName(input.fileName),
    });
    this.#deps.logger.info(
      {
        event: 'attachment.uploaded',
        userId,
        attachmentId: record.id,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
      },
      'image uploaded',
    );
    return toAttachment(record);
  }

  /** Stores a file a generation job produced. The bytes are verified like an upload. */
  async storeGenerated(
    userId: string,
    bytes: Uint8Array,
    kind: AttachmentKindValue = 'image',
  ): Promise<AttachmentRecord> {
    this.#assertEnabled();
    return kind === 'video'
      ? this.#storeVideo(userId, bytes)
      : this.#storeImage(userId, bytes, {
          source: 'generated',
          declaredType: null,
          fileName: null,
        });
  }

  /** Removes a stored file that is no longer wanted (a job cancelled while storing). Best effort. */
  async discard(record: AttachmentRecord, reason: string): Promise<void> {
    await this.removeObjects([record.storageKey], reason);
    await this.#deps.repository.deleteMany([record.id]).catch((error: unknown) => {
      this.#deps.logger.error(
        { err: error, event: 'attachment.discard.failed', reason },
        'attachment row could not be removed',
      );
    });
  }

  async find(userId: string, id: string): Promise<Attachment | null> {
    const record = await this.#deps.repository.findForUser(id, userId);
    return record ? toAttachment(record) : null;
  }

  async signedUrl(userId: string, id: string): Promise<AttachmentUrlResponse> {
    const record = await this.#deps.repository.findForUser(id, userId);
    if (!record) throw new AppError('NOT_FOUND', 'This image does not exist.');
    this.#assertEnabled();
    const url = await this.#deps.storage
      .signedUrl(record.storageKey, SIGNED_URL_TTL_SECONDS)
      .catch((error: unknown) => {
        throw this.#storageUnavailable(error, 'sign');
      });
    return {
      url,
      expiresAt: new Date(
        this.#deps.clock.now().getTime() + SIGNED_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  /**
   * Validates images for a new message and reads them for the provider. Runs
   * before quota, so a rejected image never uses up allowance.
   * @throws AppError VALIDATION_ERROR when the model cannot read images or an image is not sendable
   */
  async prepareForMessage(
    userId: string,
    ids: string[],
    model: AIModel,
  ): Promise<{ attachments: Attachment[]; images: AIImageInput[] }> {
    if (!model.supportsVision) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${model.name} cannot read images. Choose a model that supports images.`,
      );
    }
    this.#assertEnabled();
    const records = await this.#deps.repository.findManyForUser(ids, userId);
    const ordered = ids.map((id) => records.find((record) => record.id === id));
    if (ordered.some((record) => record === undefined)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'An attached image no longer exists. Attach it again.',
      );
    }
    const sendable = ordered as AttachmentRecord[];
    if (sendable.some((record) => record.kind !== 'image')) {
      throw new AppError('VALIDATION_ERROR', 'Only images can be sent with a message.');
    }
    if (sendable.some((record) => record.messageId !== null || record.source !== 'upload')) {
      throw new AppError(
        'VALIDATION_ERROR',
        'An image was already sent. Attach it again to send it with another message.',
      );
    }

    const images = await Promise.all(
      sendable.map(async (record) => {
        const bytes = await this.#deps.storage.get(record.storageKey).catch((error: unknown) => {
          throw this.#storageUnavailable(error, 'read');
        });
        return { mimeType: record.mimeType, data: Buffer.from(bytes).toString('base64') };
      }),
    );
    return { attachments: sendable.map(toAttachment), images };
  }

  /** Links sent images to the saved user message. @throws AppError when one was sent meanwhile */
  async attach(userId: string, ids: string[], messageId: string): Promise<void> {
    if (ids.length === 0) return;
    const linked = await this.#deps.repository.attachToMessage(
      ids,
      userId,
      messageId,
      this.#deps.clock.now(),
    );
    if (linked !== ids.length) {
      throw new AppError(
        'VALIDATION_ERROR',
        'An image was already sent. Attach it again to send it with another message.',
      );
    }
  }

  /** Attachments per message id, for conversation detail. */
  async forMessages(messageIds: string[]): Promise<Map<string, Attachment[]>> {
    const byMessage = new Map<string, Attachment[]>();
    for (const record of await this.#deps.repository.listForMessages(messageIds)) {
      if (record.messageId === null) continue;
      byMessage.set(record.messageId, [
        ...(byMessage.get(record.messageId) ?? []),
        toAttachment(record),
      ]);
    }
    return byMessage;
  }

  keysForConversation(conversationId: string, userId: string): Promise<string[]> {
    return this.#deps.repository.storageKeysForConversation(conversationId, userId);
  }

  generatedIdsForConversation(conversationId: string, userId: string): Promise<string[]> {
    return this.#deps.repository.generatedIdsForConversation(conversationId, userId);
  }

  /** Best effort, like `removeObjects`: rows whose objects are already gone. */
  async removeRows(ids: string[], reason: string): Promise<void> {
    if (ids.length === 0) return;
    await this.#deps.repository.deleteMany(ids).catch((error: unknown) => {
      this.#deps.logger.error(
        { err: error, event: 'attachment.rows.remove.failed', reason, rows: ids.length },
        'attachment rows could not be removed',
      );
    });
  }

  /** Best effort: a failure is logged (with a count, never keys) and never thrown. */
  async removeObjects(keys: string[], reason: string): Promise<void> {
    if (keys.length === 0 || !this.enabled) return;
    try {
      await this.#deps.storage.remove(keys);
    } catch (error) {
      this.#deps.logger.error(
        { err: error, event: 'attachment.remove.failed', reason, objects: keys.length },
        'attachment objects could not be removed',
      );
    }
  }

  /**
   * Removes uploads never sent with a message (ADR-015 §4). Objects go first, so
   * a failure leaves rows that the next run retries rather than unreachable objects.
   */
  async cleanupUnattached(
    options: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<number> {
    if (!this.enabled) return 0;
    const before = new Date(this.#deps.clock.now().getTime() - UNATTACHED_TTL_MS);
    const batchSize = options.batchSize ?? 100;
    let removed = 0;
    for (let batch = 0; batch < (options.maxBatches ?? 50); batch++) {
      const stale = await this.#deps.repository.listUnattachedBefore(before, batchSize);
      if (stale.length === 0) break;
      await this.#deps.storage.remove(stale.map((record) => record.storageKey));
      removed += await this.#deps.repository.deleteMany(stale.map((record) => record.id));
      if (stale.length < batchSize) break;
    }
    this.#deps.logger.info({ event: 'attachment.cleanup', removed }, 'unsent uploads removed');
    return removed;
  }

  async #storeImage(
    userId: string,
    bytes: Uint8Array,
    options: {
      source: AttachmentSourceValue;
      declaredType: string | null;
      fileName: string | null;
    },
  ): Promise<AttachmentRecord> {
    this.#assertSize(bytes, this.#deps.maxBytes, 'Images');

    const image = sniffImage(bytes);
    if (!image) throw unsupported();
    if (
      options.declaredType !== null &&
      normalizeDeclaredType(options.declaredType) !== image.mimeType
    ) {
      throw new AppError('VALIDATION_ERROR', "The file's content does not match its type.", {
        statusCode: 415,
      });
    }
    if (
      image.width < 1 ||
      image.height < 1 ||
      image.width > IMAGE_MAX_DIMENSION ||
      image.height > IMAGE_MAX_DIMENSION
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Images must be between 1 and ${IMAGE_MAX_DIMENSION} pixels on each side.`,
      );
    }

    let clean: Uint8Array;
    try {
      clean = stripImageMetadata(bytes, image.mimeType);
    } catch {
      throw new AppError('VALIDATION_ERROR', 'This image file is damaged or incomplete.');
    }

    return this.#save(userId, clean, {
      kind: 'image',
      source: options.source,
      mimeType: image.mimeType,
      extension: image.extension,
      width: image.width,
      height: image.height,
      fileName: options.fileName,
    });
  }

  async #storeVideo(userId: string, bytes: Uint8Array): Promise<AttachmentRecord> {
    this.#assertSize(bytes, this.#deps.videoMaxBytes ?? DEFAULT_VIDEO_MAX_BYTES, 'Videos');
    const video = sniffVideo(bytes);
    if (!video) {
      throw new AppError('VALIDATION_ERROR', 'Only MP4 and WebM videos are supported.', {
        statusCode: 415,
      });
    }
    return this.#save(userId, bytes, {
      kind: 'video',
      source: 'generated',
      mimeType: video.mimeType,
      extension: video.extension,
      width: null,
      height: null,
      fileName: null,
    });
  }

  #assertSize(bytes: Uint8Array, max: number, label: string): void {
    if (bytes.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'The file is empty.');
    }
    if (bytes.length > max) {
      throw new AppError('VALIDATION_ERROR', `${label} can be at most ${megabytes(max)} MB.`, {
        statusCode: 413,
      });
    }
  }

  async #save(
    userId: string,
    bytes: Uint8Array,
    meta: {
      kind: AttachmentKindValue;
      source: AttachmentSourceValue;
      mimeType: string;
      extension: string;
      width: number | null;
      height: number | null;
      fileName: string | null;
    },
  ): Promise<AttachmentRecord> {
    const id = randomUUID();
    const storageKey = `users/${userId}/${id}.${meta.extension}`;
    await this.#deps.storage.put(storageKey, bytes, meta.mimeType).catch((error: unknown) => {
      throw this.#storageUnavailable(error, 'upload');
    });

    try {
      return await this.#deps.repository.create({
        id,
        userId,
        kind: meta.kind,
        source: meta.source,
        mimeType: meta.mimeType,
        sizeBytes: bytes.length,
        width: meta.width,
        height: meta.height,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        fileName: meta.fileName,
        storageKey,
      });
    } catch (error) {
      await this.removeObjects([storageKey], 'metadata-save-failed');
      throw error;
    }
  }

  #assertEnabled(): void {
    if (!this.enabled) {
      throw new AppError('MODEL_UNAVAILABLE', 'Image uploads are not enabled on this deployment.', {
        retryable: false,
      });
    }
  }

  #storageUnavailable(error: unknown, action: string): AppError {
    this.#deps.logger.error(
      { err: error, event: 'attachment.storage.failed', action },
      'attachment storage failed',
    );
    return new AppError(
      'MODEL_UNAVAILABLE',
      'File storage is temporarily unavailable. Try again.',
      {
        retryable: true,
        cause: error,
      },
    );
  }
}
