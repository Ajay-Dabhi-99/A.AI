import type { SharedMessage } from '@a-ai/shared-types';
import type { PrismaClient } from '../generated/prisma/client.js';

/** Public chat snapshots (MODEL-070). */

export type ShareRecord = {
  id: string;
  token: string;
  conversationId: string;
  userId: string;
  title: string;
  messages: SharedMessage[];
  createdAt: Date;
  updatedAt: Date;
};

export type ShareSnapshot = {
  conversationId: string;
  userId: string;
  title: string;
  messages: SharedMessage[];
};

export interface ShareRepository {
  findForConversation(conversationId: string, userId: string): Promise<ShareRecord | null>;
  findByToken(token: string): Promise<ShareRecord | null>;
  /** Creates the share with `token`, or replaces the snapshot of the existing one (keeping its token). */
  save(snapshot: ShareSnapshot, token: string, at: Date): Promise<ShareRecord>;
  /** False when the chat was not shared (or is not the user's). */
  delete(conversationId: string, userId: string): Promise<boolean>;
}

type Row = Omit<ShareRecord, 'messages'> & { messages: unknown };

function toRecord(row: Row): ShareRecord {
  return { ...row, messages: Array.isArray(row.messages) ? (row.messages as SharedMessage[]) : [] };
}

export function createPrismaShareRepository(prisma: PrismaClient): ShareRepository {
  return {
    findForConversation: async (conversationId, userId) => {
      const row = await prisma.conversationShare.findFirst({ where: { conversationId, userId } });
      return row ? toRecord(row) : null;
    },

    findByToken: async (token) => {
      const row = await prisma.conversationShare.findUnique({ where: { token } });
      return row ? toRecord(row) : null;
    },

    save: async ({ conversationId, userId, title, messages }, token, at) =>
      toRecord(
        await prisma.conversationShare.upsert({
          where: { conversationId },
          create: { conversationId, userId, title, messages, token, createdAt: at, updatedAt: at },
          update: { title, messages, updatedAt: at },
        }),
      ),

    delete: async (conversationId, userId) =>
      (await prisma.conversationShare.deleteMany({ where: { conversationId, userId } })).count ===
      1,
  };
}
