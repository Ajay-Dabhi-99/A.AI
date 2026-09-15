import type {
  AIModel,
  Attachment,
  AttachmentLimits,
  ChatContextInfo,
  ChatMessage,
  ProviderInfo,
  QuotaSummary,
} from '@a-ai/shared-types';
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { resolveModel, useModelStore } from '@/stores/model-store';
import { Composer } from './composer';
import { MessageView } from './message-view';
import { useChatSession } from './use-chat-session';

const SUGGESTIONS = [
  'Explain vector databases to a product manager in two sentences.',
  'Write a SQL query that finds duplicate email addresses.',
  'Give me three names for a neighbourhood coffee shop.',
];

function formatTokens(tokens: number): string {
  if (tokens >= 10_000) return `${Math.round(tokens / 1_000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** How full the model's context was for the last request (an estimate made before the call). */
function contextSummary(context: ChatContextInfo): string {
  const percent =
    context.budgetTokens > 0
      ? Math.min(100, Math.round((context.inputTokens / context.budgetTokens) * 100))
      : 100;
  const note = context.summaryIncluded
    ? ' · earlier messages summarized'
    : context.droppedMessages > 0
      ? ` · ${context.droppedMessages} older messages left out`
      : '';
  return `Context ${formatTokens(context.inputTokens)} of ${formatTokens(context.budgetTokens)} tokens (${percent}%)${note}`;
}

export function ChatPanel({
  isGuest,
  conversationId,
  initialMessages,
  models,
  providers,
  defaultModel,
  quota,
  attachmentLimits,
  onConversationStarted,
}: {
  isGuest: boolean;
  conversationId: string | null;
  initialMessages: ChatMessage[];
  models: AIModel[];
  providers: ProviderInfo[];
  defaultModel: { provider: string; id: string } | null;
  quota: QuotaSummary | undefined;
  /** Image upload limits from /api/me (Phase 8). */
  attachmentLimits?: AttachmentLimits | undefined;
  onConversationStarted?: (conversationId: string) => void;
}) {
  const session = useChatSession({
    initialMessages,
    conversationId,
    isGuest,
    ...(onConversationStarted ? { onConversationStarted } : {}),
  });
  const selected = useModelStore((state) => state.selected);
  const select = useModelStore((state) => state.select);
  const model = resolveModel(models, selected, defaultModel);
  const listRef = useRef<HTMLDivElement>(null);

  const lastMessage = session.messages.at(-1);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 160;
    if (nearBottom || lastMessage?.role === 'user') list.scrollTop = list.scrollHeight;
  }, [lastMessage?.id, lastMessage?.content, lastMessage?.role]);

  const send = (text: string, attachments: Attachment[] = []) =>
    model ? session.send(model, text, attachments) : Promise.resolve(false);
  const { failure } = session;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-4" aria-live="polite">
        {session.messages.length === 0 ? (
          <div className="mx-auto flex max-w-xl flex-col items-center py-12 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">What would you like to ask?</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isGuest
                ? 'You are chatting as a guest. Your chat is kept for a day; create an account to save it.'
                : 'Your conversations are saved to your account.'}
            </p>
            {models.length > 0 && (
              <div className="mt-8 grid w-full gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={session.streaming}
                    onClick={() => void send(suggestion)}
                    className="rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ol className="mx-auto flex max-w-3xl flex-col gap-6">
            {session.messages.map((message) => (
              <li key={message.id}>
                <MessageView message={message} models={models} />
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-3 pt-2">
        {models.length === 0 && (
          <Alert tone="info" title="No AI model is available yet">
            The API has no provider key configured. Add a Groq, Gemini or OpenRouter key to enable
            chat.
          </Alert>
        )}

        {failure && (
          <Alert tone="danger" title={failure.message}>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {failure.accepted && failure.retryable && model && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={session.streaming}
                  onClick={() => void session.retry(model)}
                >
                  <RotateCcw aria-hidden="true" />
                  Retry
                </Button>
              )}
              {failure.code === 'QUOTA_EXCEEDED' && isGuest && (
                <Link to="/signup">Create a free account for a higher daily limit</Link>
              )}
              <button
                type="button"
                className="text-xs hover:underline"
                onClick={session.dismissFailure}
              >
                Dismiss
              </button>
            </div>
          </Alert>
        )}

        <Composer
          models={models}
          providers={providers}
          model={model}
          onSelectModel={(next) => select({ provider: next.provider, id: next.id })}
          streaming={session.streaming}
          disabled={models.length === 0}
          onSend={send}
          onStop={session.stop}
          attachmentLimits={attachmentLimits}
          isGuest={isGuest}
          footer={
            quota || session.context ? (
              <span>
                {quota && `${quota.remaining} of ${quota.limit} messages left today`}
                {session.context && (
                  <>
                    {quota && ' · '}
                    {contextSummary(session.context)}
                  </>
                )}
                {isGuest && (
                  <>
                    {' · '}
                    <Link to="/signup" className="text-primary hover:underline">
                      Sign up to save chats
                    </Link>
                  </>
                )}
              </span>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
