import type { ImageGenerationStatus } from '@a-ai/shared-types';
import { IMAGE_PROMPT_MAX_LENGTH } from '@a-ai/validation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { AttachmentImage } from '@/features/chat/attachment-image';
import { currentUser, useMe } from '@/hooks/use-me';
import { ApiError } from '@/services/api';
import { fetchImageJob, fetchImageStatus, startImageJob } from '@/services/image';

const POLL_MS = 2_000;

function ImageGenerator({ models }: { models: ImageGenerationStatus['models'] }) {
  const [modelKey, setModelKey] = useState(() =>
    models[0] ? `${models[0].provider}::${models[0].model}` : '',
  );
  const [prompt, setPrompt] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: startImageJob,
    onSuccess: ({ job }) => setJobId(job.id),
  });
  const job = useQuery({
    queryKey: ['image-job', jobId],
    queryFn: ({ signal }) => fetchImageJob(jobId as string, signal),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === undefined || status === 'queued' || status === 'processing'
        ? POLL_MS
        : false;
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const selected = models.find((item) => `${item.provider}::${item.model}` === modelKey);
    if (!selected || !prompt.trim()) return;
    setJobId(null);
    start.mutate({ provider: selected.provider, model: selected.model, prompt: prompt.trim() });
  }

  const current = job.data?.job;
  const busy = start.isPending || current?.status === 'queued' || current?.status === 'processing';

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <div>
          <label htmlFor="image-model" className="text-sm font-medium">
            Model
          </label>
          <select
            id="image-model"
            value={modelKey}
            onChange={(event) => setModelKey(event.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-surface-muted px-2 text-sm"
          >
            {models.map((item) => (
              <option
                key={`${item.provider}::${item.model}`}
                value={`${item.provider}::${item.model}`}
              >
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="image-prompt" className="text-sm font-medium">
            Describe the image
          </label>
          <textarea
            id="image-prompt"
            value={prompt}
            maxLength={IMAGE_PROMPT_MAX_LENGTH}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            className="mt-1 block w-full resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <Button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? 'Generating…' : 'Generate'}
        </Button>
      </form>

      {start.isError && (
        <Alert
          tone="danger"
          title={
            start.error instanceof ApiError ? start.error.message : 'The job could not be started.'
          }
        />
      )}
      {current?.status === 'failed' && (
        <Alert tone="danger" title="The image could not be generated">
          Error code {current.errorCode ?? 'unknown'}. Try again or choose another model.
        </Alert>
      )}
      {busy && current && (
        <p role="status" className="text-sm text-muted-foreground">
          {current.status === 'queued' ? 'Waiting to start…' : 'Generating your image…'}
        </p>
      )}
      {current?.status === 'completed' && current.attachment && (
        <figure className="space-y-2">
          <AttachmentImage
            attachment={current.attachment}
            className="w-full rounded-2xl border border-border"
          />
          <figcaption className="text-xs text-muted-foreground">{current.prompt}</figcaption>
        </figure>
      )}
    </div>
  );
}

/** Image generation (Phase 8). Says plainly when no image provider is enabled. */
export function ImagePage() {
  const me = useMe();
  const status = useQuery({
    queryKey: ['image-status'],
    queryFn: ({ signal }) => fetchImageStatus(signal),
    staleTime: 60_000,
  });

  let body: React.ReactNode;
  if (status.isPending || me.isPending) {
    body = <PageSpinner label="Loading image generation" />;
  } else if (status.isError) {
    body = <Alert tone="danger" title="Image generation status could not be loaded." />;
  } else if (!status.data.enabled) {
    body = (
      <Alert tone="info" title="Image generation is not enabled on this deployment">
        No image provider is configured, so nothing can be generated here yet. Chat can still read
        images: attach them to a message with a model that supports images.
      </Alert>
    );
  } else if (!currentUser(me.data)) {
    body = (
      <Alert tone="info" title="Sign in to generate images">
        <Link to="/login" className="text-primary hover:underline">
          Sign in
        </Link>{' '}
        or{' '}
        <Link to="/signup" className="text-primary hover:underline">
          create an account
        </Link>
        .
      </Alert>
    );
  } else {
    body = <ImageGenerator models={status.data.models} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Image generation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe an image and a model creates it as a job you can come back to.
        </p>
      </header>
      {body}
    </div>
  );
}
