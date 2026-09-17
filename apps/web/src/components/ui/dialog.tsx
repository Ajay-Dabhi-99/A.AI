import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui Dialog and Sheet on Radix: focus trap, Escape and outside click close it. */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50" />;
}

/** A centred dialog for confirmations. */
export function DialogContent({
  className,
  title,
  description,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'dialog-panel fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 text-foreground shadow-2xl',
          className,
        )}
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        {...props}
      >
        <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
        {description !== undefined && (
          <DialogPrimitive.Description className="mt-1.5 text-sm text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** A panel that slides in from the side, for navigation on small screens. */
export function SheetContent({
  className,
  side = 'left',
  title,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'left' | 'right';
  /** Names the panel for screen readers. */
  title: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        data-side={side}
        aria-describedby={undefined}
        className={cn(
          'sheet-panel fixed inset-y-0 z-50 flex w-[min(20rem,calc(100%-3rem))] flex-col bg-background px-3 pt-12 pb-3 shadow-2xl',
          side === 'left' ? 'left-0 border-r border-border' : 'right-0 border-l border-border',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
