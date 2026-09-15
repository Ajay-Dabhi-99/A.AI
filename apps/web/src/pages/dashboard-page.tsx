import type { UsageReport, UsageScope } from '@a-ai/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { formatCount, formatDay, formatMs, formatUsd } from '@/features/history/format';
import { RunsPerDayChart } from '@/features/history/runs-per-day-chart';
import { currentUser, useMe } from '@/hooks/use-me';
import { cn } from '@/lib/utils';
import { fetchUsage } from '@/services/history';

const PERIODS = [7, 30, 90] as const;

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Tiles({ report }: { report: UsageReport }) {
  const { totals } = report;
  const finished = totals.completedRuns + totals.failedRuns;
  const successRate = finished === 0 ? null : Math.round((totals.completedRuns / finished) * 100);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Tile
        label="Runs"
        value={formatCount(totals.runs)}
        note={`${formatCount(totals.failedRuns)} failed · ${formatCount(totals.cancelledRuns)} stopped${
          totals.fallbackRuns > 0
            ? ` · ${formatCount(totals.fallbackRuns)} answered by a fallback`
            : ''
        }`}
      />
      <Tile
        label="Success rate"
        value={successRate === null ? '—' : `${successRate}%`}
        note="Completed out of completed and failed runs"
      />
      <Tile
        label="Tokens in / out"
        value={`${formatCount(totals.inputTokens)} / ${formatCount(totals.outputTokens)}`}
        note={
          totals.runs === 0
            ? undefined
            : totals.providerCountedRuns === totals.runs
              ? 'Counted by the providers'
              : `Estimated for ${formatCount(totals.runs - totals.providerCountedRuns)} of ${formatCount(totals.runs)} runs`
        }
      />
      <Tile
        label="Estimated cost"
        value={totals.costedRuns === 0 ? '—' : formatUsd(totals.estimatedCostUsd)}
        note={
          totals.runs === 0
            ? undefined
            : `Prices known for ${formatCount(totals.costedRuns)} of ${formatCount(totals.runs)} runs`
        }
      />
      <Tile
        label="Average latency"
        value={formatMs(totals.averageLatencyMs)}
        note="Completed runs"
      />
      <Tile
        label="95th percentile latency"
        value={formatMs(totals.p95LatencyMs)}
        note={totals.p95LatencyMs === null ? 'Needs at least 20 completed runs' : 'Completed runs'}
      />
    </div>
  );
}

/** Token, cost and latency analytics (Phase 7): your own usage, or the deployment for admins. */
export function DashboardPage() {
  const me = useMe();
  const isAdmin = currentUser(me.data)?.role === 'admin';
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [scope, setScope] = useState<UsageScope>('personal');
  const [showTable, setShowTable] = useState(false);
  const effectiveScope: UsageScope = isAdmin ? scope : 'personal';

  const usage = useQuery({
    queryKey: ['usage', effectiveScope, days],
    queryFn: ({ signal }) => fetchUsage(effectiveScope, days, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {effectiveScope === 'deployment'
              ? 'Every user of this deployment, in totals only.'
              : 'Your chats and comparisons.'}{' '}
            Days are UTC.
          </p>
        </div>
        <Link to="/history" className="text-sm font-medium text-primary hover:underline">
          History
        </Link>
      </div>

      {/* Filters: one row above everything they scope. */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Period"
          className="inline-flex rounded-lg border border-border p-0.5"
        >
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              aria-pressed={days === period}
              onClick={() => setDays(period)}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                days === period
                  ? 'bg-surface-muted font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {period} days
            </button>
          ))}
        </div>
        {isAdmin && (
          <div
            role="group"
            aria-label="Scope"
            className="inline-flex rounded-lg border border-border p-0.5"
          >
            {(['personal', 'deployment'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={scope === option}
                onClick={() => setScope(option)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm',
                  scope === option
                    ? 'bg-surface-muted font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {option === 'personal' ? 'Mine' : 'Everyone'}
              </button>
            ))}
          </div>
        )}
      </div>

      {usage.isPending ? (
        <PageSpinner label="Loading usage" />
      ) : usage.isError ? (
        <div className="space-y-3">
          <Alert tone="danger" title="Usage could not be loaded." />
          <Button variant="secondary" onClick={() => void usage.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        // Refetching keeps the previous numbers on screen, dimmed, instead of flashing a spinner.
        <div
          className={cn('space-y-6 transition-opacity', usage.isPlaceholderData && 'opacity-60')}
        >
          {usage.data.scope === 'deployment' && usage.data.activeUsers !== null && (
            <p className="text-sm text-muted-foreground">
              {formatCount(usage.data.activeUsers)} active{' '}
              {usage.data.activeUsers === 1 ? 'user' : 'users'}
            </p>
          )}
          <Tiles report={usage.data} />

          <section
            aria-labelledby="runs-per-day"
            className="rounded-xl border border-border bg-surface p-4"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 id="runs-per-day" className="text-sm font-semibold">
                Runs per day
              </h2>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                aria-expanded={showTable}
                onClick={() => setShowTable((value) => !value)}
              >
                {showTable ? 'Hide table' : 'Show as table'}
              </button>
            </div>
            {usage.data.totals.runs === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No runs in the last {usage.data.range.days} days.
              </p>
            ) : (
              <RunsPerDayChart days={usage.data.byDay} />
            )}
            {showTable && (
              <div className="mt-3 max-h-72 overflow-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Runs per day</caption>
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1 font-medium">
                        Day
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Runs
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Failed
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Tokens
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Est. cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.data.byDay.map((day) => (
                      <tr key={day.day} className="border-t border-border">
                        <td className="py-1">{formatDay(day.day)}</td>
                        <td className="py-1 text-right tabular-nums">{day.runs}</td>
                        <td className="py-1 text-right tabular-nums">{day.failedRuns}</td>
                        <td className="py-1 text-right tabular-nums">
                          {formatCount(day.inputTokens + day.outputTokens)}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {formatUsd(day.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="by-model" className="space-y-2">
            <h2 id="by-model" className="text-sm font-semibold">
              By model
            </h2>
            {usage.data.byModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">No models were used in this period.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead className="bg-surface-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Model
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Runs
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Failed
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Tokens in / out
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Avg latency
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        p95 latency
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Est. cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.data.byModel.map((row) => (
                      <tr key={`${row.provider}/${row.model}`} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.provider}/{row.model}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCount(row.runs)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCount(row.failedRuns)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCount(row.inputTokens)} / {formatCount(row.outputTokens)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMs(row.averageLatencyMs)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatMs(row.p95LatencyMs)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.costedRuns === 0 ? '—' : formatUsd(row.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
