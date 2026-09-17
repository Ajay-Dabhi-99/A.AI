import { randomUUID } from 'node:crypto';
import type { ShareRecord, ShareRepository } from '../../src/repositories/share.repository.js';

export type MemoryShares = ShareRepository & { data: ShareRecord[] };

/** In-memory ShareRepository; the Prisma version runs in the live suite. */
export function createMemoryShares(): MemoryShares {
  const data: ShareRecord[] = [];
  const copy = (record: ShareRecord): ShareRecord => ({
    ...record,
    messages: record.messages.map((message) => ({ ...message })),
  });
  return {
    data,
    findForConversation: async (conversationId, userId) => {
      const found = data.find(
        (row) => row.conversationId === conversationId && row.userId === userId,
      );
      return found ? copy(found) : null;
    },
    findByToken: async (token) => {
      const found = data.find((row) => row.token === token);
      return found ? copy(found) : null;
    },
    save: async (snapshot, token, at) => {
      const existing = data.find((row) => row.conversationId === snapshot.conversationId);
      if (existing) {
        Object.assign(existing, {
          title: snapshot.title,
          messages: snapshot.messages,
          updatedAt: at,
        });
        return copy(existing);
      }
      const record: ShareRecord = {
        id: randomUUID(),
        token,
        ...snapshot,
        createdAt: at,
        updatedAt: at,
      };
      data.push(record);
      return copy(record);
    },
    delete: async (conversationId, userId) => {
      const index = data.findIndex(
        (row) => row.conversationId === conversationId && row.userId === userId,
      );
      if (index < 0) return false;
      data.splice(index, 1);
      return true;
    },
  };
}
