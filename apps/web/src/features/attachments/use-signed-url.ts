import { useQuery } from '@tanstack/react-query';
import { fetchAttachmentUrl } from '@/services/attachments';

/** Signed URLs last 5 minutes on the server; refresh a little before that. */
const URL_STALE_MS = 4 * 60_000;

/** A short-lived signed URL for one of the user's private files, shared per id. */
export function useSignedUrl(attachmentId: string) {
  return useQuery({
    queryKey: ['attachment-url', attachmentId],
    queryFn: ({ signal }) => fetchAttachmentUrl(attachmentId, signal),
    staleTime: URL_STALE_MS,
    gcTime: URL_STALE_MS,
    retry: false,
  });
}
