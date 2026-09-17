import type {
  Attachment,
  ChatContextInfo,
  ChatMessage,
  ChatStreamEvent,
  ErrorCode,
  MediaJob,
  RunError,
} from '@a-ai/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ME_QUERY_KEY } from '@/hooks/use-me';
import { ApiError, NetworkError } from '@/services/api';
import { jobQueryKey } from '@/features/jobs/use-media-job';
import { streamChat } from '@/services/chat';
import { startMediaJob } from '@/services/jobs';
import type { ModelRef } from '@/stores/model-store';

export type UiMessage = ChatMessage & {
  pending?: boolean;
  /** Stable React key: the id changes when the server confirms the answer. */
  key?: string;
  /** Shown while waiting: the server is retrying after a temporary provider error. */
  notice?: { code: ErrorCode } | null;
  /** The user asked for an image with this message (MODEL-065). */
  imagePrompt?: boolean;
  /** An image created in the chat, shown in place of an answer. */
  mediaJob?: MediaJob;
  /** Answered in this session, so follow-up questions can be suggested (MODEL-067). */
  fresh?: boolean;
};

/** The two chat rows an image job appears as: the request and the image. */
function imageRows(job: MediaJob): UiMessage[] {
  return [
    {
      id: `image-prompt-${job.id}`,
      role: 'user',
      content: job.prompt,
      createdAt: job.createdAt,
      imagePrompt: true,
    },
    {
      id: `image-${job.id}`,
      role: 'assistant',
      content: '',
      createdAt: job.createdAt,
      mediaJob: job,
    },
  ];
}

type RunRequest =
  | { kind: 'send'; text: string; attachments: Attachment[] }
  | { kind: 'retry' }
  | { kind: 'regenerate' }
  | { kind: 'edit'; text: string };

/** Index of the latest question (image requests are not questions). */
export function lastQuestionIndex(messages: UiMessage[]): number {
  return messages.findLastIndex((message) => message.role === 'user' && !message.imagePrompt);
}

/** The chat as the server will have it once a regenerate or edit starts. */
function rewound(messages: UiMessage[], request: RunRequest): UiMessage[] {
  if (request.kind !== 'regenerate' && request.kind !== 'edit') return messages;
  const index = lastQuestionIndex(messages);
  if (index < 0) return messages;
  return messages
    .slice(0, index + 1)
    .map((message, at) =>
      at === index && request.kind === 'edit' ? { ...message, content: request.text } : message,
    );
}

/** Saved messages and the chat's images in one timeline, oldest first. */
export function withMediaJobs(messages: ChatMessage[], jobs: MediaJob[]): UiMessage[] {
  if (jobs.length === 0) return messages;
  const rows: { at: string; order: number; items: UiMessage[] }[] = [
    ...messages.map((message, index) => ({
      at: message.createdAt,
      order: index,
      items: [message],
    })),
    ...jobs.map((job, index) => ({
      at: job.createdAt,
      order: messages.length + index,
      items: imageRows(job),
    })),
  ];
  return rows
    .sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order)
    .flatMap((row) => row.items);
}

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
  initialMessages: UiMessage[];
  conversationId: string | null;
  isGuest: boolean;
  onConversationStarted?: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<UiMessage[]>(() => {
    // Saved images start from their loaded state instead of one request each.
    for (const item of options.initialMessages) {
      if (item.mediaJob)
        queryClient.setQueryData(jobQueryKey(item.mediaJob.id), { job: item.mediaJob });
    }
    return options.initialMessages;
  });
  const [streaming, setStreaming] = useState(false);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  /** How the most recent request's context was built (Phase 5). */
  const [context, setContext] = useState<ChatContextInfo | null>(null);
  const conversationRef = useRef(options.conversationId);
  const abortRef = useRef<AbortController | null>(null);
  // The latest messages, so an edit or regenerate can be undone if the server refuses it.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  async function run(model: ModelRef, request: RunRequest): Promise<boolean> {
    const controller = new AbortController();
    abortRef.current = controller;
    const now = new Date().toISOString();
    const message = request.kind === 'send' ? request.text : null;
    const attachments = request.kind === 'send' ? request.attachments : [];
    const before = messagesRef.current;
    const userId = message ? `local-${crypto.randomUUID()}` : null;
    const answerId = `pending-${crypto.randomUUID()}`;
    const requested = { provider: model.provider, model: model.id };
    let accepted = false;

    setFailure(null);
    setStreaming(true);
    setMessages((current) => [
      ...rewound(current, request),
      ...(message && userId
        ? [
            {
              id: userId,
              role: 'user' as const,
              content: message,
              createdAt: now,
              ...(attachments.length > 0 ? { attachments } : {}),
            },
          ]
        : []),
      {
        id: answerId,
        key: answerId,
        role: 'assistant',
        content: '',
        createdAt: now,
        pending: true,
        run: { ...requested, status: 'running' },
      },
    ]);

    const updateAnswer = (change: (answer: UiMessage) => UiMessage) =>
      setMessages((current) => current.map((item) => (item.id === answerId ? change(item) : item)));
    const removeAnswer = () =>
      setMessages((current) => current.filter((item) => item.id !== answerId));
    /** The run as it stands (the answering model may have changed after a fallback). */
    const runOf = (answer: UiMessage) => answer.run ?? { ...requested, status: 'running' as const };

    const onEvent = (event: ChatStreamEvent) => {
      if (event.event === 'message.start') {
        accepted = true;
        setContext(event.data.context);
        const { conversationId } = event.data;
        if (conversationId && conversationId !== conversationRef.current) {
          conversationRef.current = conversationId;
          options.onConversationStarted?.(conversationId);
        }
      } else if (event.event === 'message.retry') {
        updateAnswer((answer) => ({ ...answer, notice: { code: event.data.code } }));
      } else if (event.event === 'message.fallback') {
        const { to } = event.data;
        updateAnswer((answer) => ({
          ...answer,
          notice: null,
          run: {
            ...runOf(answer),
            provider: to.provider,
            model: to.model,
            fallbackFrom: requested,
          },
        }));
      } else if (event.event === 'message.delta') {
        updateAnswer((answer) => ({
          ...answer,
          notice: null,
          content: answer.content + event.data.text,
        }));
      } else if (event.event === 'message.done') {
        const { status, latencyMs, messageId } = event.data;
        updateAnswer((answer) => ({
          ...answer,
          id: messageId ?? answer.id,
          pending: false,
          notice: null,
          fresh: status === 'completed',
          run: { ...runOf(answer), status, latencyMs },
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
          ...(request.kind === 'send'
            ? { message: request.text }
            : request.kind === 'edit'
              ? { edit: true, message: request.text }
              : request.kind === 'regenerate'
                ? { regenerate: true }
                : { retry: true }),
          ...(attachments.length > 0
            ? { attachmentIds: attachments.map((attachment) => attachment.id) }
            : {}),
          ...(!options.isGuest && conversationRef.current
            ? { conversationId: conversationRef.current }
            : {}),
        },
        { signal: controller.signal, onEvent },
      );
      return true;
    } catch (error) {
      if (controller.signal.aborted && !accepted && request.kind !== 'send') {
        // Stopped before the server rewound anything: put the chat back as it was.
        setMessages(before);
        return true;
      }
      if (controller.signal.aborted) {
        // Stopped before the server answered anything: nothing to keep.
        setMessages((current) =>
          current.filter((item) => !(item.id === answerId && item.content === '')),
        );
        updateAnswer((answer) => ({
          ...answer,
          pending: false,
          notice: null,
          run: { ...runOf(answer), status: 'cancelled' },
        }));
        return true;
      }

      removeAnswer();
      if (!accepted && userId) {
        setMessages((current) => current.filter((item) => item.id !== userId));
      }
      // A refused edit or regenerate changed nothing on the server.
      if (!accepted && (request.kind === 'edit' || request.kind === 'regenerate')) {
        setMessages(before);
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

  /** Starts an image inside this chat (signed-in users); a new chat is created when needed. */
  async function createImage(
    model: { provider: string; model: string },
    prompt: string,
  ): Promise<boolean> {
    setFailure(null);
    try {
      const { job } = await startMediaJob('image', {
        provider: model.provider,
        model: model.model,
        prompt,
        conversationId: conversationRef.current ?? 'new',
      });
      queryClient.setQueryData(jobQueryKey(job.id), { job });
      if (job.conversationId && job.conversationId !== conversationRef.current) {
        conversationRef.current = job.conversationId;
        options.onConversationStarted?.(job.conversationId);
      }
      setMessages((current) => [...current, ...imageRows(job)]);
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
      return true;
    } catch (error) {
      setFailure({
        code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR',
        message:
          error instanceof Error ? error.message : 'The image could not be started. Try again.',
        retryable: error instanceof ApiError ? error.retryable : true,
        accepted: false,
      });
      return false;
    }
  }

  return {
    messages,
    streaming,
    createImage,
    failure,
    context,
    /** Resolves false when the message was rejected before the answer started (the draft should be restored). */
    send: (model: ModelRef, text: string, attachments: Attachment[] = []) =>
      run(model, { kind: 'send', text, attachments }),
    retry: (model: ModelRef) => run(model, { kind: 'retry' }),
    /** Replaces the latest answer with a new one (MODEL-068). */
    regenerate: (model: ModelRef) => run(model, { kind: 'regenerate' }),
    /** Replaces the latest question and answers it again. */
    edit: (model: ModelRef, text: string) => run(model, { kind: 'edit', text }),
    stop: () => abortRef.current?.abort(new DOMException('Stopped by the user', 'AbortError')),
    dismissFailure: () => setFailure(null),
  };
}
