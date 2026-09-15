import type {
  AIUsage,
  ComparisonModelRef,
  ComparisonStreamEvent,
  RunError,
} from '@a-ai/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ME_QUERY_KEY } from '@/hooks/use-me';
import { ApiError, NetworkError } from '@/services/api';
import { streamComparison, streamComparisonRun } from '@/services/compare';

export type ColumnStatus =
  'waiting' | 'streaming' | 'completed' | 'cancelled' | 'failed' | 'timeout';

/** One model's side of the comparison. */
export type ComparisonColumnState = ComparisonModelRef & {
  runId: string | null;
  status: ColumnStatus;
  text: string;
  latencyMs: number | null;
  ttftMs: number | null;
  usage: AIUsage | null;
  estimatedCost: number | null;
  error: RunError | null;
};

type StreamOptions = { signal: AbortSignal; onEvent: (event: ComparisonStreamEvent) => void };

const CONNECTION_LOST = 'The connection was lost before this model finished. Try again.';

export function columnKey(ref: ComparisonModelRef): string {
  return `${ref.provider}::${ref.model}`;
}

/** The same key for a registry model (`id` instead of `model`). */
export function modelRefKey(model: { provider: string; id: string }): string {
  return columnKey({ provider: model.provider, model: model.id });
}

function freshColumn({ provider, model }: ComparisonModelRef): ComparisonColumnState {
  return {
    provider,
    model,
    runId: null,
    status: 'waiting',
    text: '',
    latencyMs: null,
    ttftMs: null,
    usage: null,
    estimatedCost: null,
    error: null,
  };
}

export function isActive(status: ColumnStatus): boolean {
  return status === 'waiting' || status === 'streaming';
}

function updateRun(
  columns: ComparisonColumnState[],
  runId: string,
  change: (column: ComparisonColumnState) => ComparisonColumnState,
): ComparisonColumnState[] {
  return columns.map((column) => (column.runId === runId ? change(column) : column));
}

/** Applies one stream event to the columns. Events for unknown runs change nothing. */
export function applyComparisonEvent(
  columns: ComparisonColumnState[],
  event: ComparisonStreamEvent,
): ComparisonColumnState[] {
  switch (event.event) {
    case 'comparison.start':
      return columns.map((column) => {
        const run = event.data.runs.find((candidate) => columnKey(candidate) === columnKey(column));
        return run && column.status === 'waiting' ? { ...column, runId: run.runId } : column;
      });
    case 'message.delta':
      return updateRun(columns, event.data.runId, (column) => ({
        ...column,
        status: 'streaming',
        text: column.text + event.data.text,
      }));
    case 'usage':
      return updateRun(columns, event.data.runId, (column) => ({
        ...column,
        usage: event.data.usage,
      }));
    case 'message.done':
      return updateRun(columns, event.data.runId, (column) => ({
        ...column,
        status: event.data.status,
        latencyMs: event.data.latencyMs,
        ttftMs: event.data.ttftMs,
        estimatedCost: event.data.estimatedCost,
      }));
    case 'error': {
      const { runId, status, latencyMs, code, message, retryable } = event.data;
      // The server discards a failed run's partial answer, so the column does too.
      return updateRun(columns, runId, (column) => ({
        ...column,
        status,
        text: '',
        latencyMs,
        error: { code, message, retryable },
      }));
    }
    case 'comparison.done':
      return columns;
  }
}

/**
 * Client state for one comparison: a column per model, each updated
 * independently from the multiplexed stream, per-column retry and stop.
 * The daily allowance is refreshed through TanStack Query when a stream ends.
 */
export function useComparison() {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [columns, setColumns] = useState<ComparisonColumnState[]>([]);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [failure, setFailure] = useState<RunError | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const controllers = useRef(new Set<AbortController>());

  /** Resolves false when the request was rejected before any run started. */
  async function stream(
    keys: string[],
    start: (options: StreamOptions) => Promise<void>,
    onRejected: (error: RunError) => void,
  ): Promise<boolean> {
    const controller = new AbortController();
    controllers.current.add(controller);
    setInFlight((count) => count + 1);
    let started = false;
    const settleActive = (change: (column: ComparisonColumnState) => ComparisonColumnState) =>
      setColumns((current) =>
        current.map((column) =>
          keys.includes(columnKey(column)) && isActive(column.status) ? change(column) : column,
        ),
      );

    try {
      await start({
        signal: controller.signal,
        onEvent: (event) => {
          if (event.event === 'comparison.start') {
            started = true;
            setComparisonId(event.data.comparisonId);
          }
          setColumns((current) => applyComparisonEvent(current, event));
        },
      });
      // The stream closed without a final event for some run.
      settleActive((column) => ({
        ...column,
        status: 'failed',
        text: '',
        error: { code: 'INTERNAL_ERROR', message: CONNECTION_LOST, retryable: true },
      }));
      return true;
    } catch (error) {
      if (controller.signal.aborted) {
        settleActive((column) => ({ ...column, status: 'cancelled' }));
        return true;
      }

      const runError: RunError =
        error instanceof ApiError
          ? { code: error.code, message: error.message, retryable: error.retryable }
          : {
              code: 'INTERNAL_ERROR',
              message:
                error instanceof NetworkError && started
                  ? CONNECTION_LOST
                  : error instanceof Error
                    ? error.message
                    : 'Something went wrong. Please try again.',
              retryable: true,
            };
      if (!started) {
        onRejected(runError);
        return false;
      }
      settleActive((column) => ({ ...column, status: 'failed', text: '', error: runError }));
      return true;
    } finally {
      controllers.current.delete(controller);
      setInFlight((count) => count - 1);
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    }
  }

  function compare(text: string, models: ComparisonModelRef[]): Promise<boolean> {
    setFailure(null);
    setComparisonId(null);
    setPrompt(text);
    setColumns(models.map(freshColumn));
    return stream(
      models.map(columnKey),
      (options) => streamComparison({ prompt: text, models }, options),
      (error) => {
        setFailure(error);
        setPrompt(null);
        setColumns([]);
      },
    );
  }

  function retry(ref: ComparisonModelRef): Promise<boolean> {
    if (!comparisonId) return Promise.resolve(false);
    const key = columnKey(ref);
    setColumns((current) =>
      current.map((column) => (columnKey(column) === key ? freshColumn(column) : column)),
    );
    return stream(
      [key],
      (options) =>
        streamComparisonRun(comparisonId, { provider: ref.provider, model: ref.model }, options),
      (error) =>
        setColumns((current) =>
          current.map((column) =>
            columnKey(column) === key ? { ...column, status: 'failed', error } : column,
          ),
        ),
    );
  }

  return {
    prompt,
    columns,
    comparisonId,
    failure,
    running: inFlight > 0,
    compare,
    retry,
    stop: () => {
      for (const controller of controllers.current) {
        controller.abort(new DOMException('Stopped by the user', 'AbortError'));
      }
    },
    dismissFailure: () => setFailure(null),
  };
}
