import type { PrismaClient } from '../generated/prisma/client.js';

/** Asynchronous image and video jobs (Phases 8–9, ADR-015 §6, ADR-016). */

export type JobStatusValue = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type MediaJobKindValue = 'image' | 'video';

export type GenerationJobRecord = {
  id: string;
  userId: string;
  kind: string;
  provider: string;
  model: string;
  prompt: string;
  status: JobStatusValue;
  errorCode: string | null;
  attachmentId: string | null;
  conversationId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type StaleJobFilter = {
  kind: MediaJobKindValue;
  /** PROCESSING jobs started before this were interrupted. */
  processingStartedBefore: Date;
  /** QUEUED jobs created before this were never started. */
  queuedCreatedBefore: Date;
  limit: number;
};

export interface GenerationJobRepository {
  create(data: {
    userId: string;
    kind: MediaJobKindValue;
    provider: string;
    model: string;
    prompt: string;
    conversationId?: string | null;
  }): Promise<GenerationJobRecord>;
  /** Null when it does not exist or belongs to someone else. */
  findForUser(id: string, userId: string): Promise<GenerationJobRecord | null>;
  /** The user's jobs, newest first; every kind when `kind` is null. */
  listForUser(
    userId: string,
    kind: MediaJobKindValue | null,
    limit: number,
  ): Promise<GenerationJobRecord[]>;
  /** The owner's jobs started from one chat, oldest first. */
  listForConversation(conversationId: string, userId: string): Promise<GenerationJobRecord[]>;
  /** QUEUED → PROCESSING. False when another worker claimed it first. */
  claim(id: string, at: Date): Promise<boolean>;
  /** PROCESSING → COMPLETED. False when the job was cancelled or failed meanwhile. */
  complete(id: string, attachmentId: string, at: Date): Promise<boolean>;
  /** QUEUED or PROCESSING → FAILED. False when it had already ended. */
  fail(id: string, errorCode: string, at: Date): Promise<boolean>;
  /** The owner's QUEUED or PROCESSING job → CANCELLED. False when it had already ended. */
  cancel(id: string, userId: string, at: Date): Promise<boolean>;
  /** Jobs a stopped instance left behind, oldest first. */
  listStale(filter: StaleJobFilter): Promise<GenerationJobRecord[]>;
}

export function createPrismaGenerationJobRepository(prisma: PrismaClient): GenerationJobRepository {
  return {
    create: (data) => prisma.generationJob.create({ data }),

    findForUser: (id, userId) => prisma.generationJob.findFirst({ where: { id, userId } }),

    listForUser: (userId, kind, limit) =>
      prisma.generationJob.findMany({
        where: { userId, ...(kind ? { kind } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),

    listForConversation: (conversationId, userId) =>
      prisma.generationJob.findMany({
        where: { conversationId, userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),

    claim: async (id, at) =>
      (
        await prisma.generationJob.updateMany({
          where: { id, status: 'QUEUED' },
          data: { status: 'PROCESSING', startedAt: at },
        })
      ).count === 1,

    complete: async (id, attachmentId, at) =>
      (
        await prisma.generationJob.updateMany({
          where: { id, status: 'PROCESSING' },
          data: { status: 'COMPLETED', attachmentId, completedAt: at },
        })
      ).count === 1,

    fail: async (id, errorCode, at) =>
      (
        await prisma.generationJob.updateMany({
          where: { id, status: { in: ['QUEUED', 'PROCESSING'] } },
          data: { status: 'FAILED', errorCode, completedAt: at },
        })
      ).count === 1,

    cancel: async (id, userId, at) =>
      (
        await prisma.generationJob.updateMany({
          where: { id, userId, status: { in: ['QUEUED', 'PROCESSING'] } },
          data: { status: 'CANCELLED', completedAt: at },
        })
      ).count === 1,

    listStale: ({ kind, processingStartedBefore, queuedCreatedBefore, limit }) =>
      prisma.generationJob.findMany({
        where: {
          kind,
          OR: [
            { status: 'PROCESSING', startedAt: { lt: processingStartedBefore } },
            { status: 'QUEUED', createdAt: { lt: queuedCreatedBefore } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
  };
}
