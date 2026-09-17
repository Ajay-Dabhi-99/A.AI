/** Waiting state before the first words arrive: a spinning orb and shimmering label. */
export function ThinkingIndicator({
  label = 'Thinking',
  announce = true,
}: {
  label?: string;
  /** False when a surrounding element is already the live region. */
  announce?: boolean;
}) {
  return (
    <p
      className="flex items-center gap-3 text-muted-foreground"
      role={announce ? 'status' : undefined}
    >
      <span className="thinking-orb" aria-hidden="true" />
      <span className="thinking-shimmer">{label}</span>
    </p>
  );
}
