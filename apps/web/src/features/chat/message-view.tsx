import type { AIModel, ErrorCode } from '@a-ai/shared-types';
import { Image as ImageIcon, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AttachmentImage } from './attachment-image';
import { ChatImageJob } from './chat-image-job';
import { Markdown } from './markdown';
import { ThinkingIndicator } from './thinking-indicator';
import type { UiMessage } from './use-chat-session';
import { useSmoothText } from './use-smooth-text';

function modelName(models: AIModel[], provider: string, id: string): string {
  return models.find((model) => model.provider === provider && model.id === id)?.name ?? id;
}

/** Why the server is trying again, in words a user can act on. */
function retryLabel(code: ErrorCode | undefined): string {
  switch (code) {
    case 'RATE_LIMITED':
      return 'The model is busy right now, trying again…';
    case 'PROVIDER_TIMEOUT':
      return 'The model is slow to respond, trying again…';
    default:
      return 'The model had a hiccup, trying again…';
  }
}

export function MessageView({
  message,
  models,
  imageModels = [],
  speech,
}: {
  message: UiMessage;
  models: AIModel[];
  /** Image model names, for images created in the chat. */
  imageModels?: { provider: string; model: string; name: string }[];
  /** Read-aloud control; absent when the browser has no speech voices. */
  speech?: { speaking: boolean; onToggle: () => void } | undefined;
}) {
  const smooth = useSmoothText(message.content, message.role !== 'user' && !!message.pending);

  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-2">
        {message.attachments && message.attachments.length > 0 && (
          <ul className="flex max-w-[85%] flex-wrap justify-end gap-2" aria-label="Attached images">
            {message.attachments.map((attachment) => (
              <li key={attachment.id}>
                <AttachmentImage
                  attachment={attachment}
                  className="max-h-48 max-w-48 rounded-xl border border-border object-cover"
                />
              </li>
            ))}
          </ul>
        )}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {message.imagePrompt && (
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-primary">
              <ImageIcon className="size-3.5" aria-hidden="true" />
              Create image
            </span>
          )}
          {message.content}
        </div>
      </div>
    );
  }

  if (message.mediaJob) {
    const job = message.mediaJob;
    const name =
      imageModels.find((item) => item.provider === job.provider && item.model === job.model)
        ?.name ?? job.model;
    return (
      <article className="max-w-full text-sm text-foreground">
        <ChatImageJob initial={job} modelName={name} />
      </article>
    );
  }

  const run = message.run;
  // Keep the indicator until the first words are on screen, so the row never collapses.
  const waiting = smooth.typing && smooth.text === '';

  return (
    <article
      aria-busy={smooth.typing ? true : undefined}
      className="max-w-full text-sm text-foreground"
    >
      {run?.fallbackFrom && (
        <p className="mb-2 text-xs text-muted-foreground" role="note">
          Answered by {modelName(models, run.provider, run.model)} because{' '}
          {modelName(models, run.fallbackFrom.provider, run.fallbackFrom.model)} was unavailable.
        </p>
      )}
      {waiting ? (
        <ThinkingIndicator label={message.notice ? retryLabel(message.notice.code) : 'Thinking'} />
      ) : (
        <div className={cn(smooth.typing && 'streaming-caret')}>
          <Markdown streaming={smooth.typing}>{smooth.text}</Markdown>
        </div>
      )}
      {!smooth.typing && (run || (speech && message.content)) && (
        <div className="mt-2 flex items-center gap-3">
          {run && (
            <p className="font-mono text-xs text-muted-foreground">
              {modelName(models, run.provider, run.model)}
              {run.latencyMs !== undefined && ` · ${(run.latencyMs / 1000).toFixed(1)}s`}
              {run.status === 'cancelled' && ' · stopped'}
            </p>
          )}
          {speech && message.content && (
            <button
              type="button"
              onClick={speech.onToggle}
              aria-pressed={speech.speaking}
              className="inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground"
            >
              {speech.speaking ? (
                <VolumeX className="size-3.5" aria-hidden="true" />
              ) : (
                <Volume2 className="size-3.5" aria-hidden="true" />
              )}
              {speech.speaking ? 'Stop reading' : 'Read aloud'}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
