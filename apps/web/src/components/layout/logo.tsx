import { cn } from '@/lib/utils';

/** Two bars of different heights: the same prompt, measured side by side. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7', className)}>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <rect x="8" y="9" width="6" height="15" rx="2" className="fill-lane-1" />
      <rect x="18" y="14" width="6" height="10" rx="2" className="fill-lane-4" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-2.5 font-semibold tracking-tight', className)}
    >
      <LogoMark />
      <span className="text-[1.05rem]">
        A<span className="text-primary">.ai</span>
      </span>
    </span>
  );
}
