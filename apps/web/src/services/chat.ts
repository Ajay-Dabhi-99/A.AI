import type {
  ChatStreamEvent,
  ChatSuggestionsResponse,
  ConversationDetail,
  ConversationListResponse,
  GuestConversationResponse,
  GuestMigrationResponse,
  ModelsResponse,
} from '@a-ai/shared-types';
import {
  chatSuggestionsResponseSchema,
  conversationDetailSchema,
  conversationListResponseSchema,
  guestConversationResponseSchema,
  guestMigrationResponseSchema,
  modelsResponseSchema,
  parseChatStreamEvent,
  type ChatRequest,
  type ChatSuggestionsRequest,
} from '@a-ai/validation';
import { apiRequest } from './api';
import { postEventStream } from './event-stream';

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const fetchModels = (signal?: AbortSignal): Promise<ModelsResponse> =>
  apiRequest('/api/models', { schema: modelsResponseSchema, ...withSignal(signal) });

/** Follow-up questions for an answer (MODEL-067); an empty list when none could be made. */
export const fetchChatSuggestions = (
  input: ChatSuggestionsRequest,
  signal?: AbortSignal,
): Promise<ChatSuggestionsResponse> =>
  apiRequest('/api/chat/suggestions', {
    method: 'POST',
    body: input,
    schema: chatSuggestionsResponseSchema,
    ...(signal ? { signal } : {}),
  });

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
