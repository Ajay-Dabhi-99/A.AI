import type {
  ChatStreamEvent,
  ConversationDetail,
  ConversationListResponse,
  GuestConversationResponse,
  GuestMigrationResponse,
  ModelsResponse,
} from '@a-ai/shared-types';
import {
  conversationDetailSchema,
  conversationListResponseSchema,
  guestConversationResponseSchema,
  guestMigrationResponseSchema,
  modelsResponseSchema,
  parseChatStreamEvent,
  type ChatRequest,
} from '@a-ai/validation';
import { apiRequest } from './api';
import { postEventStream } from './event-stream';

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const fetchModels = (signal?: AbortSignal): Promise<ModelsResponse> =>
  apiRequest('/api/models', { schema: modelsResponseSchema, ...withSignal(signal) });

export const fetchConversations = (signal?: AbortSignal): Promise<ConversationListResponse> =>
  apiRequest('/api/conversations', {
    schema: conversationListResponseSchema,
    ...withSignal(signal),
  });

export const fetchConversation = (id: string, signal?: AbortSignal): Promise<ConversationDetail> =>
  apiRequest(`/api/conversations/${encodeURIComponent(id)}`, {
    schema: conversationDetailSchema,
    ...withSignal(signal),
  });

export const fetchGuestConversation = (signal?: AbortSignal): Promise<GuestConversationResponse> =>
  apiRequest('/api/guest/conversation', {
    schema: guestConversationResponseSchema,
    ...withSignal(signal),
  });

export const clearGuestConversation = (): Promise<void> =>
  apiRequest('/api/guest/conversation', { method: 'DELETE' });

export const migrateGuestConversation = (): Promise<GuestMigrationResponse> =>
  apiRequest('/api/guest/migrate', { method: 'POST', schema: guestMigrationResponseSchema });

/**
 * POST /api/chat and read the Server-Sent Events it returns. EventSource cannot
 * send a POST body, so this uses fetch and the shared SSE parser.
 * Rejections before the stream starts (quota, validation, model) throw ApiError;
 * failures during the answer arrive as an `error` event.
 */
export function streamChat(
  body: ChatRequest,
  options: { signal: AbortSignal; onEvent: (event: ChatStreamEvent) => void },
): Promise<void> {
  return postEventStream('/api/chat', body, { ...options, parse: parseChatStreamEvent });
}
