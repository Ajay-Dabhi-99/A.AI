import type { ChatMessage, ChatStreamEvent, RunError } from '@a-ai/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ME_QUERY_KEY } from '@/hooks/use-me';
import { ApiError, NetworkError } from '@/services/api';
import { streamChat } from '@/services/chat';
import type { ModelRef } from '@/stores/model-store';

export type UiMessage = ChatMessage & { pending?: boolean };

export type ChatFailure = RunError & {
  /** True when the server had accepted the message, so retrying will not repeat it. */
  accepted: boolean;
};

export const CONVERSATIONS_QUERY_KEY = ['conversations'] as const;

/**
 * Client state for one chat panel: optimistic messages, the streaming answer,
 * stop, retry and failures. Server state (history, quota, conversation list)
 * is refreshed through TanStack Query when a run ends.
 */
export function useChatSession(options: {
  initialMessages: ChatMessage[];
  conversationId: string | null;
  isGuest: boolean;
  onConversationStarted?: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<UiMessage[]>(options.initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const conversationRef = useRef(options.conversationId);
  const abortRef = useRef<AbortController | null>(null);

  async function run(model: ModelRef, message: string | null): Promise<boolean> {
    const controller = new AbortController();
    abortRef.current = controller;
    const now = new Date().toISOString();
    const userId = message ? `local-${crypto.randomUUID()}` : null;
    const answerId = `pending-${crypto.randomUUID()}`;
    let accepted = false;

    setFailure(null);
    setStreaming(true);
    setMessages((current) => [
      ...current,
      ...(message && userId
        ? [{ id: userId, role: 'user' as const, content: message, createdAt: now }]
        : []),
      {
        id: answerId,
        role: 'assistant',
        content: '',
        createdAt: now,
        pending: true,
        run: { provider: model.provider, model: model.id, status: 'running' },
      },
    ]);

    const updateAnswer = (change: (answer: UiMessage) => UiMessage) =>
      setMessages((current) => current.map((item) => (item.id === answerId ? change(item) : item)));
    const removeAnswer = () =>
      setMessages((current) => current.filter((item) => item.id !== answerId));

    const onEvent = (event: ChatStreamEvent) => {
      if (event.event === 'message.start') {
        accepted = true;
        const { conversationId } = event.data;
        if (conversationId && conversationId !== conversationRef.current) {
          conversationRef.current = conversationId;
          options.onConversationStarted?.(conversationId);
        }
      } else if (event.event === 'message.delta') {
        updateAnswer((answer) => ({ ...answer, content: answer.content + event.data.text }));
      } else if (event.event === 'message.done') {
        const { status, latencyMs, messageId } = event.data;
        updateAnswer((answer) => ({
          ...answer,
          id: messageId ?? answer.id,
          pending: false,
          run: { provider: model.provider, model: model.id, status, latencyMs },
        }));
      } else if (event.event === 'error') {
        // The server keeps no partial answer on failure, so neither does the UI.
        removeAnswer();
        setFailure({ ...event.data, accepted: true });
      }
    };

    try {
      await streamChat(
        {
          provider: model.provider,
          model: model.id,
          ...(message ? { message } : { retry: true }),
          ...(!options.isGuest && conversationRef.current
            ? { conversationId: conversationRef.current }
            : {}),
        },
        { signal: controller.signal, onEvent },
      );
      return true;
    } catch (error) {
      if (controller.signal.aborted) {
        // Stopped before the server answered anything: nothing to keep.
        setMessages((current) =>
          current.filter((item) => !(item.id === answerId && item.content === '')),
        );
        updateAnswer((answer) => ({
          ...answer,
          pending: false,
          run: { provider: model.provider, model: model.id, status: 'cancelled' },
        }));
        return true;
      }

      removeAnswer();
      if (!accepted && userId) {
        setMessages((current) => current.filter((item) => item.id !== userId));
      }
      if (error instanceof ApiError) {
        setFailure({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          accepted,
        });
      } else {
        setFailure({
          code: 'INTERNAL_ERROR',
          message:
            error instanceof NetworkError && accepted
              ? 'The connection was lost while answering. Try again.'
              : error instanceof Error
                ? error.message
                : 'Something went wrong. Please try again.',
          retryable: true,
          accepted,
        });
      }
      return accepted;
    } finally {
      abortRef.current = null;
      setStreaming(false);
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      if (!options.isGuest)
        void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    }
  }

  return {
    messages,
    streaming,
    failure,
    /** Resolves false when the message was rejected before the answer started (the draft should be restored). */
    send: (model: ModelRef, text: string) => run(model, text),
    retry: (model: ModelRef) => run(model, null),
    stop: () => abortRef.current?.abort(new DOMException('Stopped by the user', 'AbortError')),
    dismissFailure: () => setFailure(null),
  };
}
