import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn/ui DropdownMenu on Radix: keyboard, focus and screen reader support built in. */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'menu-surface z-50 min-w-44 overflow-hidden rounded-xl border border-border p-1 text-foreground',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  tone = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & { tone?: 'default' | 'danger' }) {
  return (
    <DropdownMenuPrimitive.Item
      data-tone={tone}
      className={cn(
        'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        tone === 'danger' && 'text-danger data-[highlighted]:bg-danger/10 [&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}
