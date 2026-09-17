import {
  isTerminalJobStatus,
  type MediaGenerationStatus,
  type MediaJob,
  type MediaJobKind,
} from '@a-ai/shared-types';
import { MEDIA_PROMPT_MAX_LENGTH } from '@a-ai/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageSpinner } from '@/components/ui/spinner';
import { AttachmentVideo } from '@/features/attachments/attachment-video';
import { AttachmentImage } from '@/features/chat/attachment-image';
import { useMediaStatus } from '@/hooks/use-media-status';
import { currentUser, useMe } from '@/hooks/use-me';
import { ApiError } from '@/services/api';
import { cancelJob, fetchJobs, startMediaJob } from '@/services/jobs';
import { jobQueryKey, useMediaJob, type JobConnection } from './use-media-job';

const COPY: Record<
  MediaJobKind,
  { title: string; intro: string; promptLabel: string; noun: string }
> = {
  image: {
    title: 'Image generation',
    intro: 'Describe an image and a model creates it as a job you can come back to.',
    promptLabel: 'Describe the image',
    noun: 'image',
  },
  video: {
    title: 'Video generation',
    intro:
      'Describe a short video. Videos take minutes: you can refresh or leave and come back to this page.',
    promptLabel: 'Describe the video',
    noun: 'video',
  },
};

const RECENT_JOBS = 5;

const STATUS_TEXT: Record<MediaJob['status'], string> = {
  queued: 'Waiting to start…',
  processing: 'Generating…',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const CONNECTION_TEXT: Record<JobConnection, string | null> = {
  live: null,
  reconnecting: 'Connection lost. Reconnecting…',
  polling: 'Live updates are unavailable; checking every few seconds.',
};

function JobResult({ job, kind }: { job: MediaJob; kind: MediaJobKind }) {
  if (!job.attachment) return null;
  return (
    <figure className="space-y-2">
      {kind === 'video' ? (
        <AttachmentVideo attachment={job.attachment} label="Generated video" />
      ) : (
        <AttachmentImage
          attachment={job.attachment}
          className="w-full rounded-2xl border border-border"
        />
      )}
      <figcaption className="text-xs text-muted-foreground">{job.prompt}</figcaption>
    </figure>
  );
}

function CurrentJob({ jobId, kind }: { jobId: string; kind: MediaJobKind }) {
  const queryClient = useQueryClient();
  const { job, connection } = useMediaJob(jobId);
  const cancel = useMutation({
    mutationFn: () => cancelJob(jobId),
    onSuccess: (response) => queryClient.setQueryData(jobQueryKey(jobId), response),
  });

  if (job.isPending) return <PageSpinner label={`Loading the ${COPY[kind].noun} job`} />;
  if (job.isError) {
    const missing = job.error instanceof ApiError && job.error.code === 'NOT_FOUND';
    return (
      <Alert
        tone="danger"
        title={missing ? 'This job does not exist' : 'The job could not be loaded.'}
      >
        <Link to="?" className="text-primary hover:underline">
          Start a new one
        </Link>
      </Alert>
    );
  }

  const current = job.data.job;
  const active = !isTerminalJobStatus(current.status);
  const percent = current.progress === null ? null : Math.round(current.progress * 100);
  const connectionText = connection ? CONNECTION_TEXT[connection] : null;

  return (
    <section aria-label="Current job" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-sm font-medium">
          {STATUS_TEXT[current.status]}
          {active && percent !== null && ` ${percent}%`}
        </p>
        {active && (
          <Button
            size="sm"
            variant="secondary"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel
          </Button>
        )}
      </div>
      {active && (
        <div
          role="progressbar"
          aria-label={`${COPY[kind].title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === null ? {} : { 'aria-valuenow': percent })}
          className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        >
          <div
            className={
              percent === null
                ? 'h-full w-1/3 animate-pulse rounded-full bg-primary/60'
                : 'h-full rounded-full bg-primary transition-[width]'
            }
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
      {connectionText && <p className="text-xs text-muted-foreground">{connectionText}</p>}
      {current.status === 'failed' && (
        <Alert tone="danger" title={`The ${COPY[kind].noun} could not be generated`}>
          Error code {current.errorCode ?? 'unknown'}. Try again or choose another model.
        </Alert>
      )}
      {cancel.isError && (
        <Alert
          tone="danger"
          title={
            cancel.error instanceof ApiError
              ? cancel.error.message
              : 'The job could not be cancelled.'
          }
        />
      )}
      {current.status === 'completed' && <JobResult job={current} kind={kind} />}
    </section>
  );
}

function Generator({
  kind,
  models,
}: {
  kind: MediaJobKind;
  models: MediaGenerationStatus['models'];
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = searchParams.get('job');
  const [modelKey, setModelKey] = useState(() =>
    models[0] ? `${models[0].provider}::${models[0].model}` : '',
  );
  const [prompt, setPrompt] = useState('');

  const recent = useQuery({
    queryKey: ['jobs', kind],
    queryFn: ({ signal }) => fetchJobs(kind, RECENT_JOBS, signal),
  });
  const start = useMutation({
    mutationFn: (body: { provider: string; model: string; prompt: string }) =>
      startMediaJob(kind, body),
    onSuccess: ({ job }) => {
      queryClient.setQueryData(jobQueryKey(job.id), { job });
      void queryClient.invalidateQueries({ queryKey: ['jobs', kind] });
      // The id in the address is what lets a refresh pick the job up again.
      setSearchParams({ job: job.id });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const selected = models.find((item) => `${item.provider}::${item.model}` === modelKey);
    if (!selected || !prompt.trim()) return;
    start.mutate({ provider: selected.provider, model: selected.model, prompt: prompt.trim() });
  }

  const otherJobs = (recent.data?.jobs ?? []).filter((item) => item.id !== jobId);

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <div className="space-y-2">
          <Label htmlFor={`${kind}-model`}>Model</Label>
          <Select value={modelKey} onValueChange={setModelKey}>
            <SelectTrigger id={`${kind}-model`}>
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((item) => (
                <SelectItem
                  key={`${item.provider}::${item.model}`}
                  value={`${item.provider}::${item.model}`}
                >
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${kind}-prompt`}>{COPY[kind].promptLabel}</Label>
          <Textarea
            id={`${kind}-prompt`}
            value={prompt}
            maxLength={MEDIA_PROMPT_MAX_LENGTH}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>
        <Button type="submit" disabled={start.isPending || !prompt.trim()}>
          {start.isPending ? 'Starting…' : 'Generate'}
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

      {jobId && <CurrentJob key={jobId} jobId={jobId} kind={kind} />}

      {otherJobs.length > 0 && (
        <section aria-label="Recent jobs" className="space-y-2">
          <h2 className="text-sm font-medium">Recent</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {otherJobs.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link
                  to={`?job=${item.id}`}
                  className="min-w-0 truncate text-sm text-foreground hover:text-primary"
                >
                  {item.prompt}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {STATUS_TEXT[item.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Image and video generation pages (Phases 8–9). Says plainly when a kind is not enabled. */
export function MediaJobWorkspace({ kind }: { kind: MediaJobKind }) {
  const me = useMe();
  const status = useMediaStatus(kind);
  const copy = COPY[kind];

  let body: React.ReactNode;
  if (status.isPending || me.isPending) {
    body = <PageSpinner label={`Loading ${copy.title.toLowerCase()}`} />;
  } else if (status.isError) {
    body = <Alert tone="danger" title={`${copy.title} status could not be loaded.`} />;
  } else if (!status.data.enabled) {
    body = (
      <Alert tone="info" title={`${copy.title} is not enabled on this deployment`}>
        No {copy.noun} provider is configured, so nothing can be generated here yet.
        {kind === 'image' &&
          ' Chat can still read images: attach them to a message with a model that supports images.'}
      </Alert>
    );
  } else if (!currentUser(me.data)) {
    body = (
      <Alert tone="info" title={`Sign in to generate ${copy.noun}s`}>
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
    body = <Generator kind={kind} models={status.data.models} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.intro}</p>
      </header>
      {body}
    </div>
  );
}
