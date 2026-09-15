import type { Attachment, AttachmentLimits } from '@a-ai/shared-types';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api';
import { uploadAttachment } from '@/services/attachments';

export type AttachmentDraft = {
  localId: string;
  name: string;
  /** Local object URL for the thumbnail; null where the browser cannot make one. */
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'failed';
  attachment: Attachment | null;
  error: string | null;
};

function previewOf(file: File): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

function revoke(url: string | null): void {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

/**
 * Images picked for the next message. Each uploads as soon as it is chosen;
 * the API validates everything again, the checks here only save a round trip.
 */
export function useAttachmentDrafts(limits: AttachmentLimits | undefined) {
  const [items, setItems] = useState<AttachmentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) revoke(url);
    };
  }, []);

  const update = (localId: string, change: Partial<AttachmentDraft>) =>
    setItems((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...change } : item)),
    );

  function add(files: File[]) {
    if (!limits?.enabled) return;
    setError(null);
    const room = limits.maxPerMessage - items.length;
    if (files.length > room) {
      setError(`You can attach up to ${limits.maxPerMessage} images per message.`);
    }
    for (const file of files.slice(0, Math.max(0, room))) {
      if (!(limits.mimeTypes as string[]).includes(file.type)) {
        setError('Only PNG, JPEG, WebP and GIF images are supported.');
        continue;
      }
      if (file.size > limits.maxBytes) {
        setError(`Images can be at most ${Math.floor(limits.maxBytes / 1_048_576)} MB.`);
        continue;
      }
      const localId = crypto.randomUUID();
      const previewUrl = previewOf(file);
      if (previewUrl) previews.current.add(previewUrl);
      setItems((current) => [
        ...current,
        {
          localId,
          name: file.name,
          previewUrl,
          status: 'uploading',
          attachment: null,
          error: null,
        },
      ]);
      uploadAttachment(file).then(
        ({ attachment }) => update(localId, { status: 'ready', attachment }),
        (uploadError: unknown) =>
          update(localId, {
            status: 'failed',
            error:
              uploadError instanceof ApiError
                ? uploadError.message
                : 'The image could not be uploaded.',
          }),
      );
    }
  }

  function remove(localId: string) {
    const item = items.find((candidate) => candidate.localId === localId);
    if (item?.previewUrl) {
      revoke(item.previewUrl);
      previews.current.delete(item.previewUrl);
    }
    setItems((current) => current.filter((candidate) => candidate.localId !== localId));
    setError(null);
  }

  function clear() {
    for (const item of items) {
      revoke(item.previewUrl);
      if (item.previewUrl) previews.current.delete(item.previewUrl);
    }
    setItems([]);
    setError(null);
  }

  return {
    items,
    error,
    uploading: items.some((item) => item.status === 'uploading'),
    hasFailed: items.some((item) => item.status === 'failed'),
    ready: items.flatMap((item) =>
      item.status === 'ready' && item.attachment ? [item.attachment] : [],
    ),
    add,
    remove,
    clear,
  };
}
