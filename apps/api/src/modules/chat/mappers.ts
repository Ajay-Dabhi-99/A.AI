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
  return {
    id: record.id,
    role: record.role === 'USER' ? 'user' : 'assistant',
    content: record.content,
    createdAt: record.createdAt.toISOString(),
    ...(record.run
      ? {
          run: {
            provider: record.run.provider,
            model: record.run.model,
            status: toRunStatus(record.run.status),
            ...(record.run.latencyMs === null ? {} : { latencyMs: record.run.latencyMs }),
            ...(record.run.errorCode === null ? {} : { errorCode: record.run.errorCode }),
          },
        }
      : {}),
  };
}

export function toConversationSummary(record: ConversationRecord): ConversationSummary {
  return {
    id: record.id,
    title: record.title,
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
