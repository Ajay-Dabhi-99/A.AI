/** Number formatting shared by the history and dashboard pages. */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const shortDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function formatCount(value: number): string {
  return value >= 10_000 ? compact.format(value) : whole.format(value);
}

/** Cost estimates: an unknown cost is a dash, never "$0". */
export function formatUsd(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '$0';
  if (value < 0.0001) return '< $0.0001';
  return value < 1 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function formatMs(value: number | null): string {
  if (value === null) return '—';
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(2)} s`;
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** YYYY-MM-DD (UTC) as "Sep 14". */
export function formatDay(day: string): string {
  return shortDay.format(new Date(`${day}T00:00:00.000Z`));
}

/** The first day of "the last N days", as the API counts them (UTC, including today). */
export function daysAgo(days: number, now: Date = new Date()): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}
