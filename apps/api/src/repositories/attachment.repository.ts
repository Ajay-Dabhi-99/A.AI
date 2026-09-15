import type { PrismaClient } from '../generated/prisma/client.js';

/** Attachment metadata (Phases 8–9, ADR-015, ADR-016). The bytes live in object storage. */

export type AttachmentSourceValue = 'upload' | 'generated';
export type AttachmentKindValue = 'image' | 'video';

export type AttachmentRecord = {
  id: string;
  userId: string;
  /** Null until the image is sent with a message. */
  messageId: string | null;
  kind: string;
  source: string;
  mimeType: string;
  sizeBytes: number;
  /** Null for videos. */
  width: number | null;
  height: number | null;
  sha256: string;
  fileName: string | null;
  storageKey: string;
  createdAt: Date;
  attachedAt: Date | null;
};

export type NewAttachment = Pick<
  AttachmentRecord,
  | 'id'
  | 'userId'
  | 'mimeType'
  | 'sizeBytes'
  | 'width'
  | 'height'
  | 'sha256'
  | 'fileName'
  | 'storageKey'
> & { source: AttachmentSourceValue; kind: AttachmentKindValue };

export interface AttachmentRepository {
  create(data: NewAttachment): Promise<AttachmentRecord>;
  /** Null when it does not exist or belongs to someone else. */
  findForUser(id: string, userId: string): Promise<AttachmentRecord | null>;
  /** The user's attachments among `ids` (missing and foreign ids are left out). */
  findManyForUser(ids: string[], userId: string): Promise<AttachmentRecord[]>;
  /**
   * Links unsent uploads to a message. Only rows that belong to the user and
   * are not attached yet change, so two requests cannot send the same image.
   * Resolves the number of rows linked.
   */
  attachToMessage(ids: string[], userId: string, messageId: string, at: Date): Promise<number>;
  /** Attachments of the given messages, oldest first. */
  listForMessages(messageIds: string[]): Promise<AttachmentRecord[]>;
  /** Storage keys of every image sent in one of the user's conversations. */
  storageKeysForConversation(conversationId: string, userId: string): Promise<string[]>;
  /** Uploads never sent with a message, created before `before`. */
  listUnattachedBefore(before: Date, limit: number): Promise<AttachmentRecord[]>;
  deleteMany(ids: string[]): Promise<number>;
}

export function createPrismaAttachmentRepository(prisma: PrismaClient): AttachmentRepository {
  return {
    create: (data) => prisma.attachment.create({ data }),

    findForUser: (id, userId) => prisma.attachment.findFirst({ where: { id, userId } }),

    findManyForUser: (ids, userId) =>
      ids.length === 0
        ? Promise.resolve([])
        : prisma.attachment.findMany({ where: { id: { in: ids }, userId } }),

    attachToMessage: async (ids, userId, messageId, at) =>
      (
        await prisma.attachment.updateMany({
          where: { id: { in: ids }, userId, messageId: null, source: 'upload', kind: 'image' },
          data: { messageId, attachedAt: at },
        })
      ).count,

    listForMessages: (messageIds) =>
      messageIds.length === 0
        ? Promise.resolve([])
        : prisma.attachment.findMany({
            where: { messageId: { in: messageIds } },
            orderBy: [{ attachedAt: 'asc' }, { createdAt: 'asc' }],
          }),

    storageKeysForConversation: async (conversationId, userId) =>
      (
        await prisma.attachment.findMany({
          where: { userId, message: { conversationId } },
          select: { storageKey: true },
        })
      ).map((row) => row.storageKey),

    listUnattachedBefore: (before, limit) =>
      prisma.attachment.findMany({
        where: { messageId: null, source: 'upload', createdAt: { lt: before } },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),

    deleteMany: async (ids) =>
      ids.length === 0
        ? 0
        : (await prisma.attachment.deleteMany({ where: { id: { in: ids } } })).count,
  };
}
