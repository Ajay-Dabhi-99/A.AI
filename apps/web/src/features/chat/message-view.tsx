import type { AIModel, ErrorCode } from '@a-ai/shared-types';
import { Image as ImageIcon, Pencil, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { CHAT_MESSAGE_MAX_LENGTH } from '@a-ai/validation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AttachmentImage } from './attachment-image';
import { ChatImageJob } from './chat-image-job';
import { CopyButton } from './copy-button';
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
  onRegenerate,
  onEdit,
}: {
  message: UiMessage;
  models: AIModel[];
  /** Image model names, for images created in the chat. */
  imageModels?: { provider: string; model: string; name: string }[];
  /** Read-aloud control; absent when the browser has no speech voices. */
  speech?: { speaking: boolean; onToggle: () => void } | undefined;
  /** Offered on the latest answer only (MODEL-068). */
  onRegenerate?: (() => void) | undefined;
  /** Offered on the latest question only; resolves false if the edit was rejected. */
  onEdit?: ((text: string) => Promise<boolean>) | undefined;
}) {
  const smooth = useSmoothText(message.content, message.role !== 'user' && !!message.pending);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    const text = draft.trim();
    if (!onEdit || !text || text.length > CHAT_MESSAGE_MAX_LENGTH || saving) return;
    if (text === message.content) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const accepted = await onEdit(text);
    setSaving(false);
    if (accepted) setEditing(false);
  }

  function onEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void saveEdit();
    }
  }

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
        {editing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-primary/40 bg-surface p-2 shadow-sm">
            <label htmlFor={`edit-${message.id}`} className="sr-only">
              Edit your message
            </label>
            <textarea
              id={`edit-${message.id}`}
              autoFocus
              value={draft}
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onEditKeyDown}
              onFocus={(event) =>
                event.target.setSelectionRange(event.target.value.length, event.target.value.length)
              }
              className="block w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2 px-1 pt-1">
              {draft.trim().length > CHAT_MESSAGE_MAX_LENGTH && (
                <span className="mr-auto text-xs text-danger">Too long</span>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || !draft.trim() || draft.trim().length > CHAT_MESSAGE_MAX_LENGTH}
                onClick={() => void saveEdit()}
              >
                {saving ? 'Sending…' : 'Save & send'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
            {message.imagePrompt && (
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-primary">
                <ImageIcon className="size-3.5" aria-hidden="true" />
                Create image
              </span>
            )}
            {message.content}
          </div>
        )}
        {!editing && message.content && (
          <div className="user-actions flex items-center gap-1">
            <CopyButton text={message.content} showLabel={false} />
            {onEdit && (
              <button
                type="button"
                aria-label="Edit message"
                title="Edit message"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
                className="message-action"
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
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
      {!smooth.typing && (run || message.content) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {message.content && <CopyButton text={message.content} />}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="message-action"
              title="Answer again"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span>Regenerate</span>
            </button>
          )}
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
