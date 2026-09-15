import { cn } from '@/lib/utils';

/**
 * Monogram mark: a geometric "A" with the orange dot of ".ai". Theme colors
 * invert it in dark mode; `public/favicon.svg` is the fixed-color copy.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7', className)}>
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <path
        fillRule="evenodd"
        d="M7 24 12.6 8h2.8L21 24h-3.3l-1.2-3.4h-5L10.3 24Zm5.4-6.2h3.2L14 12.9Z"
        className="fill-background"
      />
      <circle cx="25.2" cy="22.8" r="2.2" className="fill-primary" />
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
