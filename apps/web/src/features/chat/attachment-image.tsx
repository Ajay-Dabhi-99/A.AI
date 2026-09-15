import type { Attachment } from '@a-ai/shared-types';
import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchAttachmentUrl } from '@/services/attachments';

/** Signed URLs last 5 minutes on the server; refresh a little before that. */
const URL_STALE_MS = 4 * 60_000;

/** One of the user's private images, shown through a short-lived signed URL. */
export function AttachmentImage({
  attachment,
  className,
}: {
  attachment: Attachment;
  className?: string;
}) {
  const signed = useQuery({
    queryKey: ['attachment-url', attachment.id],
    queryFn: ({ signal }) => fetchAttachmentUrl(attachment.id, signal),
    staleTime: URL_STALE_MS,
    gcTime: URL_STALE_MS,
    retry: false,
  });
  const label = attachment.fileName ?? 'Attached image';

  if (signed.isError) {
    return (
      <div
        role="img"
        aria-label={`${label} (unavailable)`}
        className={cn(
          'flex size-24 flex-col items-center justify-center gap-1 rounded-xl border border-border text-xs text-muted-foreground',
          className,
        )}
      >
        <ImageOff className="size-4" aria-hidden="true" />
        Unavailable
      </div>
    );
  }
  if (signed.isPending) {
    return (
      <div
        role="img"
        aria-label={`Loading ${label}`}
        className={cn('size-24 animate-pulse rounded-xl bg-surface-muted', className)}
      />
    );
  }
  return (
    <img
      src={signed.data.url}
      alt={label}
      width={attachment.width}
      height={attachment.height}
      loading="lazy"
      className={cn('h-auto', className)}
    />
  );
}
