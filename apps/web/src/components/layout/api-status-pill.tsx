import type { ReadinessResponse } from '@a-ai/shared-types';
import { useApiStatus, type ApiStatus } from '@/hooks/use-api-status';
import { cn } from '@/lib/utils';

const LABELS: Record<ApiStatus, string> = {
  checking: 'Checking API',
  operational: 'All systems operational',
  degraded: 'Partial outage',
  offline: 'API unreachable',
};

const DOT: Record<ApiStatus, string> = {
  checking: 'bg-muted-foreground',
  operational: 'bg-success text-success animate-pulse-dot',
  degraded: 'bg-warning',
  offline: 'bg-danger',
};

function describe(report: ReadinessResponse | undefined): string | undefined {
  if (!report) return undefined;
  const { database, redis, providers } = report.checks;
  return [
    `Database: ${database.status}`,
    `Redis: ${redis.status}`,
    `AI providers: ${providers.configured.length ? providers.configured.join(', ') : 'none configured'}`,
  ].join(' · ');
}

export function ApiStatusPill({ className }: { className?: string }) {
  const { status, report } = useApiStatus();

  return (
    <span
      role="status"
      title={describe(report)}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', DOT[status])} />
      {LABELS[status]}
    </span>
  );
}
