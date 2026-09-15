import { isTerminalJobStatus, type MediaJob } from '@a-ai/shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '@/services/api';
import { fetchJob, streamJob } from '@/services/jobs';

/** How the page is getting updates for an unfinished job. */
export type JobConnection = 'live' | 'reconnecting' | 'polling';

/** Waits between stream reconnects; after the last one the page polls instead. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const POLL_INTERVAL_MS = 3_000;

export const jobQueryKey = (jobId: string | null) => ['job', jobId] as const;

/**
 * Follows one job so it survives refreshes and dropped connections (ADR-016):
 * the job is loaded by id, then updated from the event stream; a dropped
 * stream reconnects with backoff and falls back to polling. Every event is a
 * full snapshot, so nothing is lost between connections.
 */
export function useMediaJob(jobId: string | null) {
  const queryClient = useQueryClient();
  const job = useQuery({
    queryKey: jobQueryKey(jobId),
    queryFn: ({ signal }) => fetchJob(jobId as string, signal),
    enabled: jobId !== null,
    staleTime: Infinity,
    retry: false,
  });
  const [connection, setConnection] = useState<JobConnection>('live');
  const status = job.data?.job.status;
  const active = jobId !== null && status !== undefined && !isTerminalJobStatus(status);

  useEffect(() => {
    if (!active || jobId === null) return;
    const controller = new AbortController();
    const update = (next: MediaJob) => queryClient.setQueryData(jobQueryKey(jobId), { job: next });
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });

    const follow = async () => {
      for (let attempt = 0; ; attempt++) {
        let ended = false;
        try {
          await streamJob(jobId, {
            signal: controller.signal,
            onEvent: ({ data }) => {
              setConnection('live');
              update(data);
              if (isTerminalJobStatus(data.status)) ended = true;
            },
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          // The job is gone (deleted account, wrong user): nothing to follow.
          if (error instanceof ApiError && error.status === 404) {
            void queryClient.invalidateQueries({ queryKey: jobQueryKey(jobId) });
            return;
          }
        }
        if (ended || controller.signal.aborted) return;
        const delay = RECONNECT_DELAYS_MS[attempt];
        if (delay === undefined) break;
        setConnection('reconnecting');
        await wait(delay);
        if (controller.signal.aborted) return;
      }

      // The stream keeps dropping (a proxy that buffers events, for example): poll instead.
      setConnection('polling');
      while (!controller.signal.aborted) {
        await wait(POLL_INTERVAL_MS);
        if (controller.signal.aborted) return;
        try {
          const { job: next } = await fetchJob(jobId, controller.signal);
          update(next);
          if (isTerminalJobStatus(next.status)) return;
        } catch {
          // Keep polling: the next attempt may succeed.
        }
      }
    };
    void follow();

    return () => controller.abort();
  }, [active, jobId, queryClient]);

  return { job, connection: active ? connection : null };
}
