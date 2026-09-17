import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Link2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/services/api';
import { createShare, deleteShare, fetchShare } from '@/services/chat';
import { CopyButton } from './copy-button';

const shareQueryKey = (conversationId: string) =>
  ['conversations', conversationId, 'share'] as const;

const errorText = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Creates, updates, copies and stops a chat's public link (MODEL-070). The
 * link shows a snapshot, so later messages stay private until it is updated.
 */
export function ShareDialog({
  conversationId,
  title,
  open,
  onOpenChange,
}: {
  conversationId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const key = shareQueryKey(conversationId);
  const share = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchShare(conversationId, signal),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () => createShare(conversationId),
    onSuccess: (response) => queryClient.setQueryData(key, response),
  });
  const stop = useMutation({
    mutationFn: () => deleteShare(conversationId),
    onSuccess: () => queryClient.setQueryData(key, { share: null }),
  });

  const current = share.data?.share ?? null;
  const url = current ? `${window.location.origin}/share/${current.token}` : '';
  const busy = save.isPending || stop.isPending;
  const failure = save.error ?? stop.error;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        title="Share chat"
        description={
          <>
            Anyone with the link can read{' '}
            <span className="font-medium text-foreground">“{title}”</span> as it is now. Later
            messages stay private until you update the link. Images and your personal instructions
            are never shared.
          </>
        }
      >
        <div className="mt-5 space-y-4">
          {share.isPending ? (
            <Spinner label="Checking the link" />
          ) : share.isError ? (
            <Alert tone="danger" title={errorText(share.error, 'The link could not be loaded.')} />
          ) : current ? (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-1.5 pl-3">
                <Globe className="size-4 shrink-0 text-success" aria-hidden="true" />
                <label htmlFor="share-url" className="sr-only">
                  Share link
                </label>
                <input
                  id="share-url"
                  readOnly
                  value={url}
                  onFocus={(event) => event.target.select()}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
                <CopyButton text={url} label="Copy link" className="shrink-0" />
              </div>
              <p className="text-xs text-muted-foreground">
                {current.messageCount} messages · snapshot from{' '}
                {dateTime.format(new Date(current.updatedAt))}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link2 className="size-4" aria-hidden="true" />
              This chat is private.
            </p>
          )}

          {failure && (
            <Alert tone="danger" title={errorText(failure, 'That did not work. Try again.')} />
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {current && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => stop.mutate()}
                className="text-danger sm:mr-auto"
              >
                {stop.isPending ? 'Stopping…' : 'Stop sharing'}
              </Button>
            )}
            {!share.isPending && !share.isError && (
              <Button disabled={busy} onClick={() => save.mutate()}>
                {save.isPending
                  ? current
                    ? 'Updating…'
                    : 'Creating…'
                  : current
                    ? 'Update link'
                    : 'Create link'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
