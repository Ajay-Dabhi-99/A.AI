import type { Attachment } from '@a-ai/shared-types';
import { ImageOff } from 'lucide-react';
import { useSignedUrl } from '@/features/attachments/use-signed-url';
import { cn } from '@/lib/utils';

/** One of the user's private images, shown through a short-lived signed URL. */
export function AttachmentImage({
  attachment,
  className,
}: {
  attachment: Attachment;
  className?: string;
}) {
  const signed = useSignedUrl(attachment.id);
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
      width={attachment.width ?? undefined}
      height={attachment.height ?? undefined}
      loading="lazy"
      className={cn('h-auto', className)}
    />
  );
}
