import type { RunStatus } from '@a-ai/shared-types';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatCount, formatDateTime, formatMs, formatUsd } from '@/features/history/format';
import { ApiError } from '@/services/api';
import { fetchConversationRuns } from '@/services/history';

const STATUS: Record<RunStatus, { label: string; tone: NonNullable<BadgeProps['tone']> }> = {
  running: { label: 'Interrupted', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  timeout: { label: 'Timed out', tone: 'danger' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
};

/** Every provider call of one saved chat, including failures (Phase 7 run detail). */
export function ConversationRunsPage() {
  const { conversationId = '' } = useParams();
  const runs = useQuery({
    queryKey: ['history', 'conversation-runs', conversationId],
    queryFn: ({ signal }) => fetchConversationRuns(conversationId, signal),
    retry: false,
  });

  let body: React.ReactNode;
  if (runs.isPending) {
    body = <PageSpinner label="Loading runs" />;
  } else if (runs.isError) {
    body =
      runs.error instanceof ApiError && runs.error.code === 'NOT_FOUND' ? (
        <Alert tone="danger" title="This conversation does not exist" />
      ) : (
        <div className="space-y-3">
          <Alert tone="danger" title="The runs could not be loaded." />
          <Button variant="secondary" onClick={() => void runs.refetch()}>
            Try again
          </Button>
        </div>
      );
  } else {
    const { conversation } = runs.data;
    body = (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{conversation.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {runs.data.runs.length} {runs.data.runs.length === 1 ? 'run' : 'runs'} · started{' '}
              {formatDateTime(conversation.createdAt)}
            </p>
          </div>
          <Link
            to={`/chat/${conversation.id}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Open chat
          </Link>
        </div>

        {runs.data.runs.length === 0 ? (
          <Alert tone="info" title="This chat has no runs yet." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Runs of {conversation.title}</caption>
              <thead className="bg-surface-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Started
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Model
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Attempts
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    First token
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Latency
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Tokens in → out
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Est. cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.data.runs.map((run) => (
                  <tr key={run.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(run.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">
                        {run.provider}/{run.model}
                      </span>
                      {run.requested && (
                        <span className="block text-xs text-muted-foreground">
                          Fallback for {run.requested.model}
                          {run.fallbackReason && ` (${run.fallbackReason})`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS[run.status].tone}>{STATUS[run.status].label}</Badge>
                      {run.errorCode && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {run.errorCode}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{run.attemptCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMs(run.ttftMs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMs(run.latencyMs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {run.inputTokens === null && run.outputTokens === null
                        ? '—'
                        : `${formatCount(run.inputTokens ?? 0)} → ${formatCount(run.outputTokens ?? 0)}`}
                      {run.usageSource === 'estimated' && (
                        <span className="block text-xs text-muted-foreground">estimated</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatUsd(run.estimatedCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
