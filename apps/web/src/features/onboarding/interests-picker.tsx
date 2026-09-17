import { INTEREST_MAX, INTEREST_MAX_LENGTH, INTEREST_TOPICS } from '@a-ai/validation';
import { Check, Plus, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * Pick up to three topics from the built-in list, or add your own (MODEL-066).
 * Controlled: the parent owns the selection and saves it.
 */
export function InterestsPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const full = value.length >= INTEREST_MAX;
  const selected = (topic: string) =>
    value.some((item) => item.toLowerCase() === topic.toLowerCase());
  const customTopics = value.filter(
    (item) => !INTEREST_TOPICS.some((topic) => topic.toLowerCase() === item.toLowerCase()),
  );

  function toggle(topic: string) {
    setError(null);
    if (selected(topic)) {
      onChange(value.filter((item) => item.toLowerCase() !== topic.toLowerCase()));
    } else if (!full) {
      onChange([...value, topic]);
    }
  }

  function addCustom() {
    const topic = custom.trim().replace(/\s+/g, ' ');
    if (!topic) return;
    if (topic.length < 2) return setError('Topics need at least 2 characters.');
    if (!/^[\p{L}\p{N}][\p{L}\p{N} &'+.#/-]*$/u.test(topic)) {
      return setError('Use letters, numbers and simple punctuation.');
    }
    if (selected(topic)) return setError('You already picked that topic.');
    if (full) return setError(`You can pick up to ${INTEREST_MAX} topics.`);
    onChange([...value, topic]);
    setCustom('');
    setError(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addCustom();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Choose up to {INTEREST_MAX}</span>
        <span aria-live="polite" className={cn(full && 'font-medium text-primary')}>
          {value.length} of {INTEREST_MAX} selected
        </span>
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Topics">
        {[...INTEREST_TOPICS, ...customTopics].map((topic) => {
          const on = selected(topic);
          const isCustom = customTopics.includes(topic);
          return (
            <li key={topic}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => toggle(topic)}
                className="topic-chip"
              >
                {on ? (
                  isCustom ? (
                    <X className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Check className="size-3.5" aria-hidden="true" />
                  )
                ) : null}
                {topic}
              </button>
            </li>
          );
        })}
      </ul>
      <div>
        <label htmlFor="custom-topic" className="text-xs font-medium">
          Add your own topic
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="custom-topic"
            value={custom}
            maxLength={INTEREST_MAX_LENGTH}
            disabled={full}
            onChange={(event) => {
              setCustom(event.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            placeholder={full ? 'Remove a topic to add another' : 'e.g. Photography'}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'custom-topic-error' : undefined}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/60 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={full || !custom.trim()}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add
          </button>
        </div>
        {error && (
          <p id="custom-topic-error" role="alert" className="mt-1.5 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
