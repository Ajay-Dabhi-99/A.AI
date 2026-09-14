import type { AIModel } from '@a-ai/shared-types';
import { cn } from '@/lib/utils';
import { Markdown } from './markdown';
import type { UiMessage } from './use-chat-session';

function modelName(models: AIModel[], provider: string, id: string): string {
  return models.find((model) => model.provider === provider && model.id === id)?.name ?? id;
}

export function MessageView({ message, models }: { message: UiMessage; models: AIModel[] }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
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
      {waiting ? (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <span className="inline-flex gap-1" aria-hidden="true">
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </span>
          Thinking…
        </p>
      ) : (
        <div className={cn(message.pending && 'streaming-caret')}>
          <Markdown>{message.content}</Markdown>
        </div>
      )}
      {run && !message.pending && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {modelName(models, run.provider, run.model)}
          {run.latencyMs !== undefined && ` · ${(run.latencyMs / 1000).toFixed(1)}s`}
          {run.status === 'cancelled' && ' · stopped'}
        </p>
      )}
    </article>
  );
}
