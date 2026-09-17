import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure pages: fall back to a hidden selection.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

/** Copies text and says so for two seconds (MODEL-068). */
export function CopyButton({
  text,
  label = 'Copy',
  className,
  showLabel = true,
}: {
  /** The text, or a function that reads it when clicked (e.g. from the DOM). */
  text: string | (() => string);
  label?: string;
  className?: string;
  showLabel?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2_000);
    return () => clearTimeout(timer);
  }, [state]);

  const shown = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;

  return (
    <button
      type="button"
      aria-label={shown}
      title={shown}
      onClick={async () => {
        const value = typeof text === 'function' ? text() : text;
        setState((await writeClipboard(value)) ? 'copied' : 'failed');
      }}
      className={cn('message-action', className)}
    >
      {state === 'copied' ? (
        <Check className="size-3.5 text-success" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {showLabel && <span>{shown}</span>}
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </button>
  );
}
