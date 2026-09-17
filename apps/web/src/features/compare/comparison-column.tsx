import type { AIUsage } from '@a-ai/shared-types';
import { RotateCcw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/features/chat/markdown';
import { ThinkingIndicator } from '@/features/chat/thinking-indicator';
import { useSmoothText } from '@/features/chat/use-smooth-text';
import { cn } from '@/lib/utils';
import { isActive, type ColumnStatus, type ComparisonColumnState } from './use-comparison';

const STATUS: Record<ColumnStatus, { label: string; tone: NonNullable<BadgeProps['tone']> }> = {
  waiting: { label: 'Waiting', tone: 'neutral' },
  streaming: { label: 'Answering', tone: 'primary' },
  completed: { label: 'Done', tone: 'success' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  timeout: { label: 'Timed out', tone: 'danger' },
};

function seconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(2)}s`;
}

function tokens(usage: AIUsage | null): string {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) return '—';
  return `${usage.inputTokens ?? '?'} → ${usage.outputTokens ?? '?'}`;
}

/** Unknown cost is never shown as zero; zero means the model is known to be free. */
function cost(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return 'Free';
  return value < 0.0001 ? '< $0.0001' : `$${value.toFixed(4)}`;
}

export function ComparisonColumn({
  column,
  modelName,
  providerName,
  fastest,
  canRetry,
  onRetry,
}: {
  column: ComparisonColumnState;
  modelName: string;
  providerName: string;
  fastest: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const status = STATUS[column.status];
  const failed = column.status === 'failed' || column.status === 'timeout';
  const smooth = useSmoothText(column.text, column.status === 'streaming');

  let body: React.ReactNode;
  if (column.status === 'waiting') {
    body = (
      <div className="space-y-3" role="status" aria-label="Waiting for the first token">
        <ThinkingIndicator announce={false} />
        <div className="h-3 w-4/5 animate-shimmer rounded bg-[linear-gradient(90deg,var(--surface-muted),var(--border),var(--surface-muted))] bg-[length:200%_100%]" />
        <div className="h-3 w-3/5 animate-shimmer rounded bg-[linear-gradient(90deg,var(--surface-muted),var(--border),var(--surface-muted))] bg-[length:200%_100%]" />
      </div>
    );
  } else if (column.error) {
    body = (
      <Alert tone="danger" title={column.error.message}>
        {canRetry && column.error.retryable && (
          <Button size="sm" variant="secondary" className="mt-1" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            Retry
          </Button>
        )}
      </Alert>
    );
  } else if (column.text) {
    body = (
      <div className={cn(smooth.typing && 'streaming-caret')}>
        <Markdown streaming={smooth.typing}>{smooth.text}</Markdown>
      </div>
    );
  } else {
    body = (
      <p className="text-muted-foreground">
        {column.status === 'cancelled'
          ? 'Stopped before an answer arrived.'
          : 'The model returned an empty answer.'}
      </p>
    );
  }

  return (
    <article
      aria-label={`${modelName} via ${providerName}`}
      aria-busy={isActive(column.status) ? true : undefined}
      className={cn(
        'flex min-h-64 min-w-0 flex-col rounded-xl border bg-surface p-4',
        failed ? 'border-danger/40' : 'border-border',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{modelName}</h2>
          <p className="truncate text-xs text-muted-foreground">{providerName}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {fastest && <Badge tone="success">Fastest</Badge>}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </header>

      <div className="mt-3 min-w-0 flex-1 overflow-x-auto text-sm">{body}</div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 font-mono text-xs">
        <div>
          <dt className="text-muted-foreground">Latency</dt>
          <dd className="tabular-nums">{seconds(column.latencyMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">First token</dt>
          <dd className="tabular-nums">{seconds(column.ttftMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {column.usage?.source === 'estimated' ? 'Tokens (est.)' : 'Tokens in → out'}
          </dt>
          <dd className="tabular-nums">{tokens(column.usage)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Est. cost</dt>
          <dd className="tabular-nums">{cost(column.estimatedCost)}</dd>
        </div>
      </dl>
    </article>
  );
}
