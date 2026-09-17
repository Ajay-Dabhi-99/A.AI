import { isTerminalJobStatus, type MediaJob } from '@a-ai/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, ImageOff, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSignedUrl } from '@/features/attachments/use-signed-url';
import { jobQueryKey, useMediaJob } from '@/features/jobs/use-media-job';
import { ApiError } from '@/services/api';
import { cancelJob } from '@/services/jobs';
import { AttachmentImage } from './attachment-image';

/** Why an image failed, in words a user can act on. */
function failureText(code: string | null): string {
  switch (code) {
    case 'RATE_LIMITED':
      return 'The free image allowance is used up for now. Try again later.';
    case 'PROVIDER_TIMEOUT':
      return 'The image took too long to create. Try again.';
    case 'MODEL_UNAVAILABLE':
      return 'The image model is unavailable right now. Try again later.';
    default:
      return 'The image could not be created. Try again or change the description.';
  }
}

function DownloadLink({ attachmentId }: { attachmentId: string }) {
  const signed = useSignedUrl(attachmentId);
  if (!signed.data) return null;
  return (
    <a
      href={signed.data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground"
    >
      <Download className="size-3.5" aria-hidden="true" />
      Open full size
    </a>
  );
}

/**
 * An image being created inside the chat. It follows the job live (and after a
 * refresh), then shows the image where the answer would be.
 */
export function ChatImageJob({ initial, modelName }: { initial: MediaJob; modelName: string }) {
  const queryClient = useQueryClient();
  const { job, connection } = useMediaJob(initial.id);
  const current = job.data?.job ?? initial;
  const active = !isTerminalJobStatus(current.status);
  const cancel = useMutation({
    mutationFn: () => cancelJob(current.id),
    onSuccess: (response) => queryClient.setQueryData(jobQueryKey(current.id), response),
  });
  const percent = current.progress === null ? null : Math.round(current.progress * 100);

  if (active) {
    return (
      <div className="space-y-2">
        <div
          role="status"
          aria-label="Creating image"
          className="image-job-placeholder flex aspect-square w-full max-w-sm flex-col items-center justify-center gap-2 rounded-2xl border border-border"
        >
          <Sparkles className="size-5 text-primary" aria-hidden="true" />
          <span className="thinking-shimmer text-sm">
            {current.status === 'queued' ? 'Getting ready…' : 'Creating image…'}
            {percent !== null && percent > 0 && percent < 100 ? ` ${percent}%` : ''}
          </span>
          {connection === 'reconnecting' && (
            <span className="text-xs text-muted-foreground">Reconnecting…</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">{modelName}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel
          </Button>
        </div>
        {cancel.isError && (
          <p role="alert" className="text-xs text-danger">
            {cancel.error instanceof ApiError
              ? cancel.error.message
              : 'The image could not be cancelled.'}
          </p>
        )}
      </div>
    );
  }

  if (current.status === 'completed' && current.attachment) {
    return (
      <figure className="space-y-2">
        <AttachmentImage
          attachment={{ ...current.attachment, fileName: current.prompt }}
          className="w-full max-w-sm rounded-2xl border border-border"
        />
        <figcaption className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">{modelName}</span>
          <DownloadLink attachmentId={current.attachment.id} />
        </figcaption>
      </figure>
    );
  }

  return (
    <div
      role={current.status === 'failed' ? 'alert' : undefined}
      className="flex max-w-sm items-start gap-2.5 rounded-xl border border-border bg-surface-muted/60 px-3 py-2.5 text-sm"
    >
      <ImageOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">
        {current.status === 'cancelled'
          ? 'Image creation was cancelled.'
          : failureText(current.errorCode)}
      </span>
    </div>
  );
}
