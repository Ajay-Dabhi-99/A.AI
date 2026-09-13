import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  info: {
    icon: Info,
    className: 'border-border bg-surface-muted text-foreground',
    iconClass: 'text-muted-foreground',
  },
  success: {
    icon: CircleCheck,
    className: 'border-success/30 bg-success/10 text-foreground',
    iconClass: 'text-success',
  },
  danger: {
    icon: CircleAlert,
    className: 'border-danger/30 bg-danger/10 text-foreground',
    iconClass: 'text-danger',
  },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass, iconClass } = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-xl border p-3.5 text-sm', toneClass, className)}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', iconClass)} />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && (
          <div className="text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
