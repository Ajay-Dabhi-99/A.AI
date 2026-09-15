import type { AIModel } from '@a-ai/shared-types';
import { Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AttachmentImage } from './attachment-image';
import { Markdown } from './markdown';
import type { UiMessage } from './use-chat-session';

function modelName(models: AIModel[], provider: string, id: string): string {
  return models.find((model) => model.provider === provider && model.id === id)?.name ?? id;
}

export function MessageView({
  message,
  models,
  speech,
}: {
  message: UiMessage;
  models: AIModel[];
  /** Read-aloud control; absent when the browser has no speech voices. */
  speech?: { speaking: boolean; onToggle: () => void } | undefined;
}) {
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
          {message.content}
        </div>
      </div>
    );
  }

  const run = message.run;
  const waiting = message.pending && message.content === '';

  return (
    <article
      aria-busy={message.pending ? true : undefined}
      className="max-w-full text-sm text-foreground"
    >
      {run?.fallbackFrom && (
        <p className="mb-2 text-xs text-muted-foreground" role="note">
          Answered by {modelName(models, run.provider, run.model)} because{' '}
          {modelName(models, run.fallbackFrom.provider, run.fallbackFrom.model)} was unavailable.
        </p>
      )}
      {waiting ? (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <span className="inline-flex gap-1" aria-hidden="true">
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </span>
          {message.notice === 'retrying' ? 'Retrying after a temporary error…' : 'Thinking…'}
        </p>
      ) : (
        <div className={cn(message.pending && 'streaming-caret')}>
          <Markdown>{message.content}</Markdown>
        </div>
      )}
      {!message.pending && (run || (speech && message.content)) && (
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
