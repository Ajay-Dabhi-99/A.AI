import type { AIModel, ProviderInfo } from '@a-ai/shared-types';
import { CHAT_MESSAGE_MAX_LENGTH } from '@a-ai/validation';
import { ArrowUp, Square } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function modelKey(model: Pick<AIModel, 'provider' | 'id'>): string {
  return `${model.provider}::${model.id}`;
}

export function Composer({
  models,
  providers,
  model,
  onSelectModel,
  streaming,
  disabled,
  onSend,
  onStop,
  footer,
}: {
  models: AIModel[];
  /** Provider display names come from the API, never from the client (Phase 3 gate). */
  providers: ProviderInfo[];
  model: AIModel | undefined;
  onSelectModel: (model: AIModel) => void;
  streaming: boolean;
  disabled: boolean;
  /** Resolves false if the message was rejected; the draft is then restored. */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  footer?: React.ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const tooLong = draft.length > CHAT_MESSAGE_MAX_LENGTH;
  const canSend =
    !disabled && !streaming && !tooLong && draft.trim().length > 0 && model !== undefined;

  const providerIds = [...new Set(models.map((item) => item.provider))];

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const text = draft.trim();
    setDraft('');
    const accepted = await onSend(text);
    if (!accepted) setDraft(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-border bg-surface p-2 shadow-sm focus-within:border-primary/50"
    >
      <label htmlFor="chat-input" className="sr-only">
        Message
      </label>
      <textarea
        id="chat-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        placeholder={disabled ? 'Chat is unavailable right now' : 'Ask anything…'}
        disabled={disabled}
        aria-invalid={tooLong ? true : undefined}
        className="block w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:cursor-not-allowed"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="chat-model" className="sr-only">
            Model
          </label>
          <select
            id="chat-model"
            value={model ? modelKey(model) : ''}
            onChange={(event) => {
              const next = models.find((item) => modelKey(item) === event.target.value);
              if (next) onSelectModel(next);
            }}
            disabled={streaming || models.length === 0}
            className="h-8 max-w-[14rem] truncate rounded-lg border border-border bg-surface-muted px-2 text-xs text-foreground"
          >
            {providerIds.map((provider) => (
              <optgroup
                key={provider}
                label={providers.find((item) => item.id === provider)?.name ?? provider}
              >
                {models
                  .filter((item) => item.provider === provider)
                  .map((item) => (
                    <option key={modelKey(item)} value={modelKey(item)}>
                      {item.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {(tooLong || draft.length > CHAT_MESSAGE_MAX_LENGTH * 0.9) && (
            <span
              className={cn('font-mono text-xs', tooLong ? 'text-danger' : 'text-muted-foreground')}
            >
              {draft.length.toLocaleString()} / {CHAT_MESSAGE_MAX_LENGTH.toLocaleString()}
            </span>
          )}
        </div>
        {streaming ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={onStop}
            aria-label="Stop generating"
          >
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message">
            <ArrowUp />
          </Button>
        )}
      </div>
      {footer && <div className="px-2 pt-1.5 pb-0.5 text-xs text-muted-foreground">{footer}</div>}
    </form>
  );
}
