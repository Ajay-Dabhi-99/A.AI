import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground/70 hover:border-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
