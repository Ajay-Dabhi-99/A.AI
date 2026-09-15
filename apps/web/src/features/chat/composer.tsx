import type { AIModel, Attachment, AttachmentLimits, ProviderInfo } from '@a-ai/shared-types';
import { CHAT_MESSAGE_MAX_LENGTH } from '@a-ai/validation';
import { ArrowUp, ImagePlus, Loader2, Mic, Square, X } from 'lucide-react';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAttachmentDrafts } from './use-attachment-drafts';
import { useVoiceInput } from './use-voice-input';

function modelKey(model: Pick<AIModel, 'provider' | 'id'>): string {
  return `${model.provider}::${model.id}`;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
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
  attachmentLimits,
  voice,
  isGuest = false,
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
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onStop: () => void;
  /** What the caller may attach (from /api/me). Absent or disabled hides the attach button. */
  attachmentLimits?: AttachmentLimits | undefined;
  /** Voice input limits; absent when speech-to-text is off or the browser cannot record. */
  voice?: { maxBytes: number; maxSeconds: number } | undefined;
  isGuest?: boolean;
  footer?: React.ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const drafts = useAttachmentDrafts(attachmentLimits);
  const voiceInput = useVoiceInput({
    maxSeconds: voice?.maxSeconds ?? 120,
    maxBytes: voice?.maxBytes ?? 0,
    // The transcript is added to the draft, never sent on its own: the user reviews it first.
    onTranscript: (text) =>
      setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text)),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const tooLong = draft.length > CHAT_MESSAGE_MAX_LENGTH;
  const canAttach = attachmentLimits?.enabled === true;
  const readsImages = model?.supportsVision === true;
  const imagesBlocked = drafts.items.length > 0 && !readsImages;
  const canSend =
    !disabled &&
    !streaming &&
    !tooLong &&
    draft.trim().length > 0 &&
    model !== undefined &&
    !drafts.uploading &&
    !drafts.hasFailed &&
    !imagesBlocked &&
    voiceInput.state === 'idle';

  const providerIds = [...new Set(models.map((item) => item.provider))];

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const text = draft.trim();
    const images = drafts.ready;
    setDraft('');
    const accepted = await onSend(text, images);
    if (!accepted) setDraft(text);
    else if (images.length > 0) drafts.clear();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  const failures = drafts.items.filter((item) => item.status === 'failed');
  const recording = voiceInput.state === 'recording';

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-border bg-surface p-2 shadow-sm focus-within:border-primary/50"
    >
      {drafts.items.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-1 pt-1 pb-2" aria-label="Images to send">
          {drafts.items.map((item) => (
            <li key={item.localId} className="relative">
              {item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt={item.name}
                  className={cn(
                    'size-16 rounded-lg border object-cover',
                    item.status === 'failed' ? 'border-danger' : 'border-border',
                    item.status === 'uploading' && 'opacity-50',
                  )}
                />
              ) : (
                <div
                  className={cn(
                    'flex size-16 items-center justify-center truncate rounded-lg border px-1 text-[10px] text-muted-foreground',
                    item.status === 'failed' ? 'border-danger' : 'border-border',
                  )}
                >
                  {item.name}
                </div>
              )}
              {item.status === 'uploading' && (
                <span className="sr-only" role="status">
                  Uploading {item.name}
                </span>
              )}
              <button
                type="button"
                onClick={() => drafts.remove(item.localId)}
                aria-label={`Remove ${item.name}`}
                className="absolute -top-1.5 -right-1.5 rounded-full border border-border bg-surface p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {(drafts.error || failures.length > 0 || imagesBlocked || voiceInput.error) && (
        <div role="alert" className="space-y-0.5 px-2 pb-1.5 text-xs text-danger">
          {drafts.error && <p>{drafts.error}</p>}
          {failures.map((item) => (
            <p key={item.localId}>
              {item.name}: {item.error}
            </p>
          ))}
          {imagesBlocked && (
            <p>
              {model?.name ?? 'This model'} can't read images. Choose a model that supports images.
            </p>
          )}
          {voiceInput.error && <p>{voiceInput.error}</p>}
        </div>
      )}

      <label htmlFor="chat-input" className="sr-only">
        Message
      </label>
      <textarea
        id="chat-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        rows={Math.min(8, Math.max(2, draft.split('\n').length))}
        placeholder={
          disabled
            ? 'Chat is unavailable right now'
            : voiceInput.state === 'transcribing'
              ? 'Transcribing your recording…'
              : 'Ask anything…'
        }
        disabled={disabled}
        aria-invalid={tooLong ? true : undefined}
        className="block w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:cursor-not-allowed"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          {canAttach && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={attachmentLimits.mimeTypes.join(',')}
                aria-label="Image files"
                tabIndex={-1}
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files) drafts.add([...event.target.files]);
                  event.target.value = '';
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Attach images"
                title={
                  readsImages ? 'Attach images' : `${model?.name ?? 'This model'} can't read images`
                }
                disabled={
                  disabled ||
                  streaming ||
                  !readsImages ||
                  drafts.items.length >= attachmentLimits.maxPerMessage
                }
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus />
              </Button>
            </>
          )}
          {voice && (
            <Button
              type="button"
              size="icon"
              variant={recording ? 'secondary' : 'ghost'}
              aria-label={
                recording
                  ? 'Stop recording'
                  : voiceInput.state === 'transcribing'
                    ? 'Transcribing'
                    : 'Record voice message'
              }
              aria-pressed={recording}
              disabled={disabled || streaming || voiceInput.state === 'transcribing'}
              onClick={() => (recording ? voiceInput.stop() : void voiceInput.start())}
            >
              {voiceInput.state === 'transcribing' ? (
                <Loader2 className="animate-spin" />
              ) : recording ? (
                <Square className="fill-current text-danger" />
              ) : (
                <Mic />
              )}
            </Button>
          )}
          {recording && voice && (
            <span role="status" className="font-mono text-xs text-danger">
              Recording {clock(voiceInput.seconds)} / {clock(voice.maxSeconds)}
            </span>
          )}
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
          {isGuest && readsImages && (
            <Link
              to="/signup"
              className="hidden text-xs text-muted-foreground hover:text-primary sm:inline"
            >
              Sign up to attach images
            </Link>
          )}
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
