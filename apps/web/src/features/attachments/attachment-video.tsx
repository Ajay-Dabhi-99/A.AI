import type { Attachment } from '@a-ai/shared-types';
import { VideoOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSignedUrl } from './use-signed-url';

/** A generated video, played from a short-lived signed URL. */
export function AttachmentVideo({
  attachment,
  label,
  className,
}: {
  attachment: Attachment;
  label: string;
  className?: string;
}) {
  const signed = useSignedUrl(attachment.id);

  if (signed.isError) {
    return (
      <div
        role="img"
        aria-label={`${label} (unavailable)`}
        className={cn(
          'flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-2xl border border-border text-xs text-muted-foreground',
          className,
        )}
      >
        <VideoOff className="size-5" aria-hidden="true" />
        Unavailable
      </div>
    );
  }
  if (signed.isPending) {
    return (
      <div
        role="img"
        aria-label={`Loading ${label}`}
        className={cn('aspect-video w-full animate-pulse rounded-2xl bg-surface-muted', className)}
      />
    );
  }
  return (
    <video
      src={signed.data.url}
      controls
      preload="metadata"
      aria-label={label}
      className={cn('w-full rounded-2xl border border-border bg-black', className)}
    />
  );
}
