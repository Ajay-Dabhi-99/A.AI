import { useEffect, useState } from 'react';

const FRAME_MS = 32;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** Next reveal position: a few characters (more when far behind), ending on a word boundary. */
function nextPosition(text: string, shown: number): number {
  const backlog = text.length - shown;
  let end = Math.min(text.length, shown + Math.max(3, Math.ceil(backlog / 10)));
  const limit = Math.min(text.length, end + 24);
  while (end < limit && !/\s/.test(text.charAt(end))) end += 1;
  return end;
}

/**
 * Types streamed text out word by word at a steady pace instead of in
 * network-sized chunks. Speed scales with the backlog, and the reveal finishes
 * smoothly after the stream ends. Only text that streamed while this component
 * was mounted animates; history renders at once.
 */
export function useSmoothText(text: string, streaming: boolean): { text: string; typing: boolean } {
  const [started, setStarted] = useState(streaming);
  const [shown, setShown] = useState(0);
  if (streaming && !started) setStarted(true);

  const animate = started && !prefersReducedMotion();
  const target = text.length;
  const behind = animate && shown < target;

  useEffect(() => {
    if (!behind) return;
    const timer = setTimeout(() => setShown((current) => nextPosition(text, current)), FRAME_MS);
    return () => clearTimeout(timer);
  }, [behind, shown, text]);

  if (!animate) return { text, typing: streaming };
  return { text: text.slice(0, Math.min(shown, target)), typing: streaming || behind };
}
