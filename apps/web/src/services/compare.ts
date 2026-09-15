import type { ComparisonStreamEvent } from '@a-ai/shared-types';
import {
  parseComparisonStreamEvent,
  type ComparisonRequest,
  type ComparisonRunRequest,
} from '@a-ai/validation';
import { postEventStream } from './event-stream';

type StreamOptions = {
  signal: AbortSignal;
  onEvent: (event: ComparisonStreamEvent) => void;
};

/** POST /api/compare: every model's answer on one stream, multiplexed by runId. */
export function streamComparison(body: ComparisonRequest, options: StreamOptions): Promise<void> {
  return postEventStream('/api/compare', body, { ...options, parse: parseComparisonStreamEvent });
}

/** POST /api/compare/:comparisonId/runs: the comparison's prompt on one model again. */
export function streamComparisonRun(
  comparisonId: string,
  body: ComparisonRunRequest,
  options: StreamOptions,
): Promise<void> {
  return postEventStream(`/api/compare/${encodeURIComponent(comparisonId)}/runs`, body, {
    ...options,
    parse: parseComparisonStreamEvent,
  });
}
