import {
  parseSseStream,
  type ChatStreamEvent,
  type ConversationDetail,
  type ConversationListResponse,
  type GuestConversationResponse,
  type GuestMigrationResponse,
  type ModelsResponse,
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
import { ApiError, apiRequest, apiUrl, NetworkError, toApiError } from './api';

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
export async function streamChat(
  body: ChatRequest,
  options: { signal: AbortSignal; onEvent: (event: ChatStreamEvent) => void },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new NetworkError(error);
  }

  if (!response.ok) throw await toApiError(response);
  if (!response.body) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'The answer could not be read.',
      status: response.status,
      retryable: true,
    });
  }

  try {
    for await (const message of parseSseStream(response.body)) {
      const event = parseChatStreamEvent(message.event, message.data);
      if (event) options.onEvent(event);
    }
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new NetworkError(error);
  }
}
