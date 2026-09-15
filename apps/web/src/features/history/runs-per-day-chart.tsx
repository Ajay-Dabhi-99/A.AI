import type { UsageByDay } from '@a-ai/shared-types';
import { useState } from 'react';
import { formatCount, formatDay, formatUsd } from './format';

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 36 };
const MAX_BAR = 24;
const RADIUS = 4;

/** Clean ticks from zero: steps of 1, 2 or 5 × 10ⁿ, at most five labels. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step =
    [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => max / candidate <= 4) ??
    10 * magnitude;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
}

/** A bar with a 4px rounded data end and a square base on the baseline. */
function barPath(x: number, y: number, width: number, base: number): string {
  const r = Math.min(RADIUS, width / 2, base - y);
  if (r <= 0) return '';
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${base} Z`;
}

/**
 * Runs per UTC day: one series, so no legend box (the heading names it).
 * Every bar has a hover and keyboard-focus tooltip; the same numbers are in the
 * table view next to the chart.
 */
export function RunsPerDayChart({ days }: { days: UsageByDay[] }) {
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(0, ...days.map((day) => day.runs)));
  const top = ticks.at(-1) as number;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const base = PAD.top + plotHeight;
  const band = plotWidth / Math.max(1, days.length);
  const barWidth = Math.max(2, Math.min(MAX_BAR, band - 2));
  const y = (value: number) => PAD.top + plotHeight * (1 - value / top);
  // At most eight date labels, evenly spaced, always including the last day.
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  const activeDay = active === null ? null : days[active];
  const total = days.reduce((sum, day) => sum + day.runs, 0);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Runs per day: ${formatCount(total)} runs over ${days.length} days`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[11px] tabular-nums"
            >
              {formatCount(tick)}
            </text>
          </g>
        ))}

        {days.map((day, index) => {
          const x = PAD.left + index * band + (band - barWidth) / 2;
          const showLabel = (days.length - 1 - index) % labelEvery === 0;
          return (
            <g key={day.day}>
              {day.runs > 0 && (
                <path
                  d={barPath(x, y(day.runs), barWidth, base)}
                  className={active === index ? 'fill-primary-hover' : 'fill-primary'}
                />
              )}
              {showLabel && (
                <text
                  x={x + barWidth / 2}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {formatDay(day.day)}
                </text>
              )}
              {/* The hit target is the whole column, not just the painted bar. */}
              <rect
                x={PAD.left + index * band}
                y={PAD.top}
                width={band}
                height={plotHeight}
                fill="transparent"
                tabIndex={0}
                aria-label={`${formatDay(day.day)}: ${day.runs} runs, ${day.failedRuns} failed`}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive((current) => (current === index ? null : current))}
                onFocus={() => setActive(index)}
                onBlur={() => setActive((current) => (current === index ? null : current))}
                className="cursor-default outline-none focus-visible:stroke-primary"
              />
            </g>
          );
        })}
      </svg>

      {activeDay && active !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm"
          style={{ left: `${((PAD.left + (active + 0.5) * band) / WIDTH) * 100}%` }}
        >
          <p className="font-semibold text-foreground tabular-nums">
            {formatCount(activeDay.runs)} runs
          </p>
          <p className="text-muted-foreground">
            {formatDay(activeDay.day)} · {activeDay.failedRuns} failed ·{' '}
            {formatCount(activeDay.inputTokens + activeDay.outputTokens)} tokens ·{' '}
            {formatUsd(activeDay.estimatedCostUsd)} est.
          </p>
        </div>
      )}
    </div>
  );
}
