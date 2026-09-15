import type { RunDetail, RunStatus } from '@a-ai/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { ComparisonColumn } from '@/features/compare/comparison-column';
import type { ColumnStatus, ComparisonColumnState } from '@/features/compare/use-comparison';
import { formatDateTime } from '@/features/history/format';
import { useModels } from '@/hooks/use-models';
import { ApiError } from '@/services/api';
import { fetchComparisonDetail } from '@/services/history';

const COLUMN_STATUS: Record<RunStatus, ColumnStatus> = {
  running: 'cancelled',
  completed: 'completed',
  failed: 'failed',
  timeout: 'timeout',
  cancelled: 'cancelled',
};

/** A saved run shown in the same column as a live comparison, read-only. */
function toColumn(run: RunDetail & { content: string | null }): ComparisonColumnState {
  const failed = run.status === 'failed' || run.status === 'timeout';
  return {
    provider: run.provider,
    model: run.model,
    runId: run.id,
    status: COLUMN_STATUS[run.status],
    text: run.content ?? '',
    latencyMs: run.latencyMs,
    ttftMs: run.ttftMs,
    usage:
      run.usageSource === null
        ? null
        : {
            source: run.usageSource,
            ...(run.inputTokens === null ? {} : { inputTokens: run.inputTokens }),
            ...(run.outputTokens === null ? {} : { outputTokens: run.outputTokens }),
          },
    estimatedCost: run.estimatedCostUsd,
    error: failed
      ? {
          code: 'INTERNAL_ERROR',
          message: `This model did not answer (${run.errorCode ?? 'unknown error'}).`,
          retryable: false,
        }
      : null,
  };
}

const GRID: Record<number, string> = {
  1: '',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-2 xl:grid-cols-3',
};

/** A saved comparison reopened from history (Phase 7). */
export function ComparisonDetailPage() {
  const { comparisonId = '' } = useParams();
  const models = useModels();
  const detail = useQuery({
    queryKey: ['history', 'comparison', comparisonId],
    queryFn: ({ signal }) => fetchComparisonDetail(comparisonId, signal),
    retry: false,
  });

  const nameOf = (provider: string, id: string) =>
    models.data?.models.find((model) => model.provider === provider && model.id === id)?.name ?? id;
  const providerNameOf = (id: string) =>
    models.data?.providers.find((provider) => provider.id === id)?.name ?? id;

  let body: React.ReactNode;
  if (detail.isPending) {
    body = <PageSpinner label="Loading comparison" />;
  } else if (detail.isError) {
    body =
      detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND' ? (
        <Alert tone="danger" title="This comparison does not exist" />
      ) : (
        <div className="space-y-3">
          <Alert tone="danger" title="The comparison could not be loaded." />
          <Button variant="secondary" onClick={() => void detail.refetch()}>
            Try again
          </Button>
        </div>
      );
  } else {
    const runs = detail.data.runs;
    body = (
      <>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Saved comparison</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateTime(detail.data.createdAt)}
          </p>
        </div>
        <p className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 py-2 text-sm">
          <span className="mt-0.5 font-mono text-xs text-primary">prompt</span>
          <span className="min-w-0 break-words whitespace-pre-wrap">{detail.data.prompt}</span>
        </p>
        {runs.length === 0 ? (
          <Alert tone="info" title="This comparison has no runs." />
        ) : (
          <div className={`grid gap-3 ${GRID[Math.min(3, runs.length)] ?? ''}`}>
            {runs.map((run) => (
              <ComparisonColumn
                key={run.id}
                column={toColumn(run)}
                modelName={nameOf(run.provider, run.model)}
                providerName={providerNameOf(run.provider)}
                fastest={false}
                canRetry={false}
                onRetry={() => undefined}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-5">
      <Link to="/history" className="text-sm font-medium text-primary hover:underline">
        ← History
      </Link>
      {body}
    </div>
  );
}
