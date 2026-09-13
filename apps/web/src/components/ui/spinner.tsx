import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}
    >
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </span>
  );
}

export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[50svh] items-center justify-center px-5">
      <Spinner label={label} />
    </div>
  );
}
