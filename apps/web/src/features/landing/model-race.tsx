import { CircleAlert } from 'lucide-react';
import { useInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  FASTEST_LANE_ID,
  laneFrameAt,
  RACE_LANES,
  RACE_PROMPT,
  RACE_SETTLED_MS,
  type LaneColor,
  type RaceLane,
} from './race-data';

const TICK_MS = 50;
const HOLD_AFTER_SETTLED_MS = 4_000;
const CYCLE_MS = RACE_SETTLED_MS + HOLD_AFTER_SETTLED_MS;

const DOT_CLASS: Record<LaneColor, string> = {
  'lane-1': 'bg-lane-1',
  'lane-2': 'bg-lane-2',
  'lane-3': 'bg-lane-3',
  'lane-4': 'bg-lane-4',
};

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * One number of state drives every lane; each lane is a pure function of it.
 * The clock pauses off-screen and in background tabs, and reduced-motion users
 * see the settled result without animation.
 */
function useRaceClock(active: boolean, reducedMotion: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active || reducedMotion) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      setElapsed((previous) => (previous + TICK_MS) % CYCLE_MS);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, reducedMotion]);

  return reducedMotion ? RACE_SETTLED_MS : elapsed;
}

function Lane({ lane, t }: { lane: RaceLane; t: number }) {
  const frame = laneFrameAt(lane, t);
  const isFastest = frame.status === 'done' && lane.id === FASTEST_LANE_ID;

  return (
    <article
      aria-label={`${lane.model} via ${lane.provider}`}
      className={cn(
        'flex min-h-52 flex-col rounded-xl border bg-surface p-4 transition-colors duration-300',
        frame.status === 'failed' ? 'border-danger/40' : 'border-border',
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('size-2.5 shrink-0 rounded-full', DOT_CLASS[lane.color])}
          />
          <span className="truncate text-sm font-medium">{lane.model}</span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {lane.provider}
          </span>
        </div>
        {isFastest && <Badge tone="success">Fastest</Badge>}
        {frame.status === 'failed' && <Badge tone="danger">Failed</Badge>}
      </header>

      <div className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
        {frame.status === 'waiting' ? (
          <div className="space-y-2" aria-label="Waiting for first token">
            <div className="h-3 w-4/5 animate-shimmer rounded bg-[linear-gradient(90deg,var(--surface-muted),var(--border),var(--surface-muted))] bg-[length:200%_100%]" />
            <div className="h-3 w-3/5 animate-shimmer rounded bg-[linear-gradient(90deg,var(--surface-muted),var(--border),var(--surface-muted))] bg-[length:200%_100%]" />
          </div>
        ) : (
          <p className="text-foreground/90">
            {frame.text}
            {frame.status === 'streaming' && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-caret bg-primary"
              />
            )}
          </p>
        )}
        {frame.status === 'failed' && lane.failure && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {lane.failure.message}
          </p>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 font-mono text-xs">
        <div>
          <dt className="text-muted-foreground">Latency</dt>
          <dd className="tabular-nums">{formatSeconds(frame.elapsedMs)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tokens (est.)</dt>
          <dd className="tabular-nums">{frame.estimatedTokens}</dd>
        </div>
      </dl>
    </article>
  );
}

export function ModelRace() {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { margin: '0px 0px -10% 0px' });
  const reducedMotion = useReducedMotion() ?? false;
  const t = useRaceClock(inView, reducedMotion);

  return (
    <div
      ref={containerRef}
      className="rounded-2xl border border-border bg-surface-muted/60 p-3 sm:p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="font-mono text-xs text-primary">prompt</span>
          <span className="truncate">{RACE_PROMPT}</span>
        </div>
        <span className="text-xs text-muted-foreground">Illustrative preview, not a benchmark</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {RACE_LANES.map((lane) => (
          <Lane key={lane.id} lane={lane} t={t} />
        ))}
      </div>
    </div>
  );
}
