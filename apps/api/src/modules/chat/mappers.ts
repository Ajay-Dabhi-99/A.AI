import type { ChatMessage, ConversationSummary, RunStatus } from '@a-ai/shared-types';
import type {
  ConversationRecord,
  MessageRecord,
  RunStatusValue,
} from '../../repositories/conversation.repository.js';

export function toRunStatus(status: RunStatusValue): RunStatus {
  return status.toLowerCase() as RunStatus;
}

export function toChatMessage(record: MessageRecord): ChatMessage {
  const run = record.run;
  return {
    id: record.id,
    role: record.role === 'USER' ? 'user' : 'assistant',
    content: record.content,
    createdAt: record.createdAt.toISOString(),
    ...(run
      ? {
          run: {
            provider: run.provider,
            model: run.model,
            status: toRunStatus(run.status),
            ...(run.latencyMs === null ? {} : { latencyMs: run.latencyMs }),
            ...(run.errorCode === null ? {} : { errorCode: run.errorCode }),
            ...(run.requestedProvider !== null && run.requestedModel !== null
              ? { fallbackFrom: { provider: run.requestedProvider, model: run.requestedModel } }
              : {}),
          },
        }
      : {}),
  };
}

export function toConversationSummary(record: ConversationRecord): ConversationSummary {
  return {
    id: record.id,
    title: record.title,
    pinnedAt: record.pinnedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Single line, whitespace collapsed, at most 60 characters. */
export function conversationTitle(message: string): string {
  const line = message.replace(/\s+/g, ' ').trim();
  if (!line) return 'New chat';
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}
