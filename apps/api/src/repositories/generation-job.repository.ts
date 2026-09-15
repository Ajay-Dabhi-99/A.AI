import type { PrismaClient } from '../generated/prisma/client.js';

/** Asynchronous image-generation jobs (Phase 8, ADR-015 §6). */

export type JobStatusValue = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

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
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export interface GenerationJobRepository {
  create(data: {
    userId: string;
    provider: string;
    model: string;
    prompt: string;
  }): Promise<GenerationJobRecord>;
  /** Null when it does not exist or belongs to someone else. */
  findForUser(id: string, userId: string): Promise<GenerationJobRecord | null>;
  /** QUEUED → PROCESSING. False when another worker claimed it first. */
  claim(id: string, at: Date): Promise<boolean>;
  complete(id: string, attachmentId: string, at: Date): Promise<void>;
  fail(id: string, errorCode: string, at: Date): Promise<void>;
}

export function createPrismaGenerationJobRepository(prisma: PrismaClient): GenerationJobRepository {
  return {
    create: (data) => prisma.generationJob.create({ data: { ...data, kind: 'image' } }),

    findForUser: (id, userId) => prisma.generationJob.findFirst({ where: { id, userId } }),

    claim: async (id, at) =>
      (
        await prisma.generationJob.updateMany({
          where: { id, status: 'QUEUED' },
          data: { status: 'PROCESSING', startedAt: at },
        })
      ).count === 1,

    complete: async (id, attachmentId, at) => {
      await prisma.generationJob.updateMany({
        where: { id, status: 'PROCESSING' },
        data: { status: 'COMPLETED', attachmentId, completedAt: at },
      });
    },

    fail: async (id, errorCode, at) => {
      await prisma.generationJob.updateMany({
        where: { id, status: { in: ['QUEUED', 'PROCESSING'] } },
        data: { status: 'FAILED', errorCode, completedAt: at },
      });
    },
  };
}
