import type { PersonalInstructions } from '@a-ai/shared-types';
import { INSTRUCTIONS_MAX_LENGTH } from '@a-ai/validation';
import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { useInstructions, useUpdateInstructions } from '@/hooks/use-instructions';
import { ApiError } from '@/services/api';
import { cn } from '@/lib/utils';

const EXAMPLES = {
  about: 'e.g. I am a frontend developer in Ahmedabad. I work mostly with React and TypeScript.',
  style: 'e.g. Keep answers short, use bullet points, and show code in TypeScript.',
};

function Field({
  id,
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const over = value.trim().length > INSTRUCTIONS_MAX_LENGTH;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className={cn('font-mono text-xs', over ? 'text-danger' : 'text-muted-foreground')}>
          {value.trim().length}/{INSTRUCTIONS_MAX_LENGTH}
        </span>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      <textarea
        id={id}
        value={value}
        rows={4}
        placeholder={placeholder}
        aria-describedby={`${id}-hint`}
        aria-invalid={over || undefined}
        onChange={(event) => onChange(event.target.value)}
        className="block w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
      />
    </div>
  );
}

function InstructionsForm({
  saved,
  save,
}: {
  saved: PersonalInstructions;
  save: ReturnType<typeof useUpdateInstructions>;
}) {
  const [about, setAbout] = useState(saved.about ?? '');
  const [style, setStyle] = useState(saved.style ?? '');
  const [enabled, setEnabled] = useState(saved.enabled);

  const tooLong =
    about.trim().length > INSTRUCTIONS_MAX_LENGTH || style.trim().length > INSTRUCTIONS_MAX_LENGTH;
  const changed =
    about.trim() !== (saved.about ?? '') ||
    style.trim() !== (saved.style ?? '') ||
    enabled !== saved.enabled;

  return (
    <form
      className="mt-5 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed || tooLong) return;
        save.mutate({ about: about.trim() || null, style: style.trim() || null, enabled });
      }}
    >
      <Field
        id="instructions-about"
        label="What should A.ai know about you?"
        hint="Your work, interests or context that helps it give better answers."
        value={about}
        placeholder={EXAMPLES.about}
        onChange={setAbout}
      />
      <Field
        id="instructions-style"
        label="How should A.ai respond?"
        hint="Tone, length, format or language you prefer."
        value={style}
        placeholder={EXAMPLES.style}
        onChange={setStyle}
      />
      <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5">
        <Checkbox
          checked={enabled}
          onCheckedChange={(value) => setEnabled(value === true)}
          aria-describedby="instructions-enabled-hint"
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-medium">Use these in new messages</span>
          <span id="instructions-enabled-hint" className="block text-xs text-muted-foreground">
            Turn off to keep them saved without sending them.
          </span>
        </span>
      </label>
      {save.isError && (
        <Alert
          tone="danger"
          title={
            save.error instanceof ApiError
              ? save.error.message
              : 'Your instructions could not be saved.'
          }
        />
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p role="status" className="text-xs text-muted-foreground">
          {save.isSuccess && !changed
            ? 'Instructions saved.'
            : 'Only used in your signed-in chats.'}
        </p>
        <Button type="submit" size="sm" disabled={!changed || tooLong || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save instructions'}
        </Button>
      </div>
    </form>
  );
}

/** Profile card for personal instructions (MODEL-069). */
export function InstructionsCard() {
  const instructions = useInstructions();
  // Owned here: the form restarts from the saved values after a save, the result stays.
  const save = useUpdateInstructions();
  const saved = instructions.data?.instructions;

  return (
    <section
      aria-labelledby="instructions-title"
      className="rounded-2xl border border-border bg-surface p-6"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessageSquareText className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="instructions-title" className="text-base font-semibold">
            Personal instructions
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A.ai takes these into account in every chat.
          </p>
        </div>
      </div>
      {instructions.isPending ? (
        <Spinner label="Loading instructions" className="mt-5" />
      ) : instructions.isError || !saved ? (
        <Alert tone="danger" title="Your instructions could not be loaded." className="mt-5" />
      ) : (
        <InstructionsForm key={JSON.stringify(saved)} saved={saved} save={save} />
      )}
    </section>
  );
}
