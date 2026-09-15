import { randomUUID } from 'node:crypto';
import type {
  AttachmentRecord,
  AttachmentRepository,
} from '../../src/repositories/attachment.repository.js';
import type {
  GenerationJobRecord,
  GenerationJobRepository,
} from '../../src/repositories/generation-job.repository.js';
import { StorageError, type ObjectStorage } from '../../src/services/storage/object-storage.js';

export type MemoryAttachments = AttachmentRepository & { data: AttachmentRecord[] };

/**
 * In-memory AttachmentRepository. `conversationOf` maps a message id to its
 * conversation, as the SQL join does; the Prisma version runs in the live suite.
 */
export function createMemoryAttachments(
  conversationOf: (messageId: string) => string | undefined = () => undefined,
): MemoryAttachments {
  const data: AttachmentRecord[] = [];
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 13, 9, 0, 0) + tick++);

  return {
    data,

    create: async (input) => {
      const record: AttachmentRecord = {
        ...input,
        messageId: null,
        createdAt: now(),
        attachedAt: null,
      };
      data.push(record);
      return { ...record };
    },

    findForUser: async (id, userId) => {
      const found = data.find((record) => record.id === id && record.userId === userId);
      return found ? { ...found } : null;
    },

    findManyForUser: async (ids, userId) =>
      data
        .filter((record) => ids.includes(record.id) && record.userId === userId)
        .map((record) => ({ ...record })),

    attachToMessage: async (ids, userId, messageId, at) => {
      let count = 0;
      for (const record of data) {
        if (
          ids.includes(record.id) &&
          record.userId === userId &&
          record.messageId === null &&
          record.source === 'upload' &&
          record.kind === 'image'
        ) {
          record.messageId = messageId;
          record.attachedAt = at;
          count += 1;
        }
      }
      return count;
    },

    listForMessages: async (messageIds) =>
      data
        .filter((record) => record.messageId !== null && messageIds.includes(record.messageId))
        .map((record) => ({ ...record })),

    storageKeysForConversation: async (conversationId, userId) =>
      data
        .filter(
          (record) =>
            record.userId === userId &&
            record.messageId !== null &&
            conversationOf(record.messageId) === conversationId,
        )
        .map((record) => record.storageKey),

    listUnattachedBefore: async (before, limit) =>
      data
        .filter(
          (record) =>
            record.messageId === null && record.source === 'upload' && record.createdAt < before,
        )
        .slice(0, limit)
        .map((record) => ({ ...record })),

    deleteMany: async (ids) => {
      const before = data.length;
      data.splice(0, data.length, ...data.filter((record) => !ids.includes(record.id)));
      return before - data.length;
    },
  };
}

export type MemoryStorage = ObjectStorage & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  /** When set, every operation fails like an unreachable storage service. */
  failing: boolean;
};

/** A private bucket in memory. Signed URLs are fake but shaped like Supabase's. */
export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage: MemoryStorage = {
    enabled: true,
    objects,
    failing: false,
    async put(key, bytes, contentType) {
      if (storage.failing) throw new StorageError('Storage upload failed with HTTP 503', 503);
      if (objects.has(key)) throw new StorageError('Storage upload failed with HTTP 409', 409);
      objects.set(key, { bytes: new Uint8Array(bytes), contentType });
    },
    async get(key) {
      if (storage.failing) throw new StorageError('Storage download failed with HTTP 503', 503);
      const object = objects.get(key);
      if (!object) throw new StorageError('Storage download failed with HTTP 404', 404);
      return object.bytes;
    },
    async signedUrl(key, expiresInSeconds) {
      if (storage.failing) throw new StorageError('Storage signed URL failed with HTTP 503', 503);
      return `https://storage.test/storage/v1/object/sign/bucket/${key}?token=${randomUUID()}&expires=${expiresInSeconds}`;
    },
    async remove(keys) {
      if (storage.failing) throw new StorageError('Storage delete failed with HTTP 503', 503);
      for (const key of keys) objects.delete(key);
    },
  };
  return storage;
}

export type MemoryGenerationJobs = GenerationJobRepository & { data: GenerationJobRecord[] };

/** In-memory GenerationJobRepository with the same compare-and-set rules as the SQL one. */
export function createMemoryGenerationJobs(
  now: () => Date = () => new Date(),
): MemoryGenerationJobs {
  const data: GenerationJobRecord[] = [];
  const find = (id: string) => data.find((job) => job.id === id);
  const active = (job: GenerationJobRecord | undefined) =>
    job !== undefined && (job.status === 'QUEUED' || job.status === 'PROCESSING');

  return {
    data,
    create: async (input) => {
      const job: GenerationJobRecord = {
        id: randomUUID(),
        ...input,
        status: 'QUEUED',
        errorCode: null,
        attachmentId: null,
        createdAt: now(),
        startedAt: null,
        completedAt: null,
      };
      data.push(job);
      return { ...job };
    },
    findForUser: async (id, userId) => {
      const job = find(id);
      return job && job.userId === userId ? { ...job } : null;
    },
    listForUser: async (userId, kind, limit) =>
      data
        .filter((job) => job.userId === userId && (kind === null || job.kind === kind))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((job) => ({ ...job })),
    claim: async (id, at) => {
      const job = find(id);
      if (!job || job.status !== 'QUEUED') return false;
      Object.assign(job, { status: 'PROCESSING', startedAt: at });
      return true;
    },
    complete: async (id, attachmentId, at) => {
      const job = find(id);
      if (job?.status !== 'PROCESSING') return false;
      Object.assign(job, { status: 'COMPLETED', attachmentId, completedAt: at });
      return true;
    },
    fail: async (id, errorCode, at) => {
      const job = find(id);
      if (!active(job)) return false;
      Object.assign(job as GenerationJobRecord, { status: 'FAILED', errorCode, completedAt: at });
      return true;
    },
    cancel: async (id, userId, at) => {
      const job = find(id);
      if (!active(job) || job?.userId !== userId) return false;
      Object.assign(job, { status: 'CANCELLED', completedAt: at });
      return true;
    },
    listStale: async ({ kind, processingStartedBefore, queuedCreatedBefore, limit }) =>
      data
        .filter(
          (job) =>
            job.kind === kind &&
            ((job.status === 'PROCESSING' &&
              job.startedAt !== null &&
              job.startedAt < processingStartedBefore) ||
              (job.status === 'QUEUED' && job.createdAt < queuedCreatedBefore)),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit)
        .map((job) => ({ ...job })),
  };
}
