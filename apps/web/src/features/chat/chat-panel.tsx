import type {
  AIModel,
  Attachment,
  AttachmentLimits,
  ChatContextInfo,
  ChatMessage,
  MediaJob,
  ProviderInfo,
  QuotaSummary,
} from '@a-ai/shared-types';
import { ArrowDown, RotateCcw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { resolveModel, useModelStore } from '@/stores/model-store';
import { useAudioStatus } from '@/hooks/use-audio-status';
import { useMediaStatus } from '@/hooks/use-media-status';
import { Composer } from './composer';
import { MessageView } from './message-view';
import { starterPrompts } from '@/features/onboarding/topic-suggestions';
import { useInstructions } from '@/hooks/use-instructions';
import { currentUser, useMe } from '@/hooks/use-me';
import { FollowUpSuggestions } from './follow-up-suggestions';
import {
  lastQuestionIndex,
  useChatSession,
  withMediaJobs,
  type UiMessage,
} from './use-chat-session';
import { speechSupported, useReadAloud } from './use-read-aloud';
import { voiceInputSupported } from './use-voice-input';

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

/** The user message an answer replied to (skipping image requests). */
function questionBefore(messages: UiMessage[], index: number): string {
  for (let at = index - 1; at >= 0; at--) {
    const candidate = messages[at];
    if (candidate?.role === 'user' && !candidate.imagePrompt) return candidate.content;
  }
  return '';
}

export function ChatPanel({
  isGuest,
  conversationId,
  initialMessages,
  initialMediaJobs,
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
  /** Images created in this chat (MODEL-065). */
  initialMediaJobs?: MediaJob[] | undefined;
  models: AIModel[];
  providers: ProviderInfo[];
  defaultModel: { provider: string; id: string } | null;
  quota: QuotaSummary | undefined;
  /** Image upload limits from /api/me (Phase 8). */
  attachmentLimits?: AttachmentLimits | undefined;
  onConversationStarted?: (conversationId: string) => void;
}) {
  const session = useChatSession({
    initialMessages: withMediaJobs(initialMessages, initialMediaJobs ?? []),
    conversationId,
    isGuest,
    ...(onConversationStarted ? { onConversationStarted } : {}),
  });
  const selected = useModelStore((state) => state.selected);
  const select = useModelStore((state) => state.select);
  const model = resolveModel(models, selected, defaultModel);
  const listRef = useRef<HTMLDivElement>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const audio = useAudioStatus();
  const interests = currentUser(useMe().data)?.interests ?? [];
  const saved = useInstructions(!isGuest).data?.instructions;
  const instructionsOn =
    !isGuest && saved !== undefined && saved.enabled && Boolean(saved.about || saved.style);
  const starters = starterPrompts(interests, SUGGESTIONS);
  // Signed-in users can create images right here when image generation is enabled.
  const imageStatus = useMediaStatus('image');
  const imageModel = !isGuest && imageStatus.data?.enabled ? imageStatus.data.models[0] : undefined;
  const readAloud = useReadAloud();
  const canSpeak = speechSupported();
  const transcription = audio.data?.transcription;
  const voice =
    transcription?.enabled && voiceInputSupported()
      ? { maxBytes: transcription.maxBytes, maxSeconds: transcription.maxDurationSeconds }
      : undefined;

  const contentRef = useRef<HTMLDivElement>(null);
  /** Whether new content should keep the view pinned to the bottom. */
  const stickRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastMessage = session.messages.at(-1);

  // A new answer starting (send or retry) always brings the view down to it,
  // even if the reader had scrolled up, before the browser paints. The question
  // and its pending answer are added together, so the answer marks the send.
  // A new answer or a newly requested image.
  const pendingKey =
    lastMessage?.pending || lastMessage?.mediaJob ? (lastMessage.key ?? lastMessage.id) : null;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !pendingKey) return;
    stickRef.current = true;
    list.scrollTop = list.scrollHeight;
    lastScrollTopRef.current = list.scrollTop;
    setAwayFromBottom(false);
  }, [pendingKey]);

  // Follow the answer as it types: pin to the bottom whenever the content grows.
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return;
      list.scrollTop = list.scrollHeight;
      lastScrollTopRef.current = list.scrollTop;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
    // Only the reader scrolling up stops the follow; growing content never does.
    if (list.scrollTop < lastScrollTopRef.current - 2) stickRef.current = false;
    if (distance < 80) stickRef.current = true;
    lastScrollTopRef.current = list.scrollTop;
    setAwayFromBottom(distance > 240);
  };
  const scrollToBottom = () => {
    const list = listRef.current;
    if (!list) return;
    stickRef.current = true;
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  };

  // Regenerate and edit apply to the latest question and its answer only (MODEL-068).
  const questionIndex = lastQuestionIndex(session.messages);
  const question = session.messages[questionIndex];
  const answer = session.messages[questionIndex + 1];
  const tailIsQuestionAndAnswer =
    questionIndex >= 0 && questionIndex >= session.messages.length - 2;
  const canRegenerate =
    tailIsQuestionAndAnswer &&
    answer?.role === 'assistant' &&
    !answer.pending &&
    !answer.mediaJob &&
    Boolean(answer.content) &&
    !session.streaming;
  const canEdit =
    tailIsQuestionAndAnswer &&
    !session.streaming &&
    !question?.attachments?.length &&
    (answer === undefined || (!answer.pending && !answer.mediaJob));

  const send = (text: string, attachments: Attachment[] = []) =>
    model ? session.send(model, text, attachments) : Promise.resolve(false);
  const { failure } = session;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          onScroll={onListScroll}
          className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-1 pt-4 pb-10"
          aria-live="polite"
        >
          <div ref={contentRef}>
            {session.messages.length === 0 ? (
              <div className="mx-auto flex max-w-xl flex-col items-center py-12 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">
                  What would you like to ask?
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {isGuest
                    ? 'You are chatting as a guest. Your chat is kept for a day; create an account to save it.'
                    : 'Your conversations are saved to your account.'}
                </p>
                {models.length > 0 && (
                  <div className="mt-8 grid w-full gap-2">
                    {interests.length > 0 && (
                      <p className="mb-1 text-left text-xs text-muted-foreground">
                        Suggested for your topics: {interests.join(' · ')} ·{' '}
                        <Link to="/settings" className="text-primary hover:underline">
                          Change
                        </Link>
                      </p>
                    )}
                    {starters.map((suggestion) => (
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
                {session.messages.map((message, index) => (
                  <li key={message.key ?? message.id}>
                    <MessageView
                      message={message}
                      models={models}
                      imageModels={imageStatus.data?.models ?? []}
                      speech={
                        canSpeak && message.role === 'assistant'
                          ? {
                              speaking: readAloud.speakingId === message.id,
                              onToggle: () => readAloud.toggle(message.id, message.content),
                            }
                          : undefined
                      }
                      onRegenerate={
                        canRegenerate && index === questionIndex + 1 && model
                          ? () => void session.regenerate(model)
                          : undefined
                      }
                      onEdit={
                        canEdit && index === questionIndex && model
                          ? (text) => session.edit(model, text)
                          : undefined
                      }
                    />
                    {index === session.messages.length - 1 &&
                      message.fresh &&
                      message.content &&
                      !failure && (
                        <FollowUpSuggestions
                          answerKey={message.key ?? message.id}
                          question={questionBefore(session.messages, index)}
                          answer={message.content}
                          disabled={session.streaming}
                          onPick={(text) => void send(text)}
                        />
                      )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
        {awayFromBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label="Scroll to the latest message"
            className="absolute bottom-3 left-1/2 inline-flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-lg transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
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
          voice={voice}
          isGuest={isGuest}
          imageCreation={
            imageModel
              ? {
                  modelName: imageModel.name,
                  onCreate: (prompt) => session.createImage(imageModel, prompt),
                }
              : undefined
          }
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
                {instructionsOn && (
                  <>
                    {' · '}
                    <Link to="/settings" className="text-primary hover:underline">
                      Personal instructions on
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
