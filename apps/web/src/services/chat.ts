import type {
  ChatStreamEvent,
  ChatSuggestionsResponse,
  ConversationShareResponse,
  SharedConversation,
  ConversationDetail,
  ConversationListResponse,
  GuestConversationResponse,
  GuestMigrationResponse,
  ModelsResponse,
} from '@a-ai/shared-types';
import {
  chatSuggestionsResponseSchema,
  conversationShareResponseSchema,
  sharedConversationSchema,
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

const shareUrl = (conversationId: string) =>
  `/api/conversations/${encodeURIComponent(conversationId)}/share`;

/** A chat's public link, or null when it is not shared (MODEL-070). */
export const fetchShare = (
  conversationId: string,
  signal?: AbortSignal,
): Promise<ConversationShareResponse> =>
  apiRequest(shareUrl(conversationId), {
    schema: conversationShareResponseSchema,
    ...withSignal(signal),
  });

/** Creates the link, or updates its snapshot to the chat as it is now. */
export const createShare = (conversationId: string): Promise<ConversationShareResponse> =>
  apiRequest(shareUrl(conversationId), {
    method: 'POST',
    schema: conversationShareResponseSchema,
  });

export const deleteShare = (conversationId: string): Promise<void> =>
  apiRequest(shareUrl(conversationId), { method: 'DELETE' });

/** Public: a shared chat by its token. */
export const fetchSharedConversation = (
  token: string,
  signal?: AbortSignal,
): Promise<SharedConversation> =>
  apiRequest(`/api/shared/${encodeURIComponent(token)}`, {
    schema: sharedConversationSchema,
    ...withSignal(signal),
  });

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
