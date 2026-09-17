import type { AuthUser } from '@a-ai/shared-types';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUpdateInterests } from '@/features/auth/use-auth-actions';
import { ApiError } from '@/services/api';
import { InterestsPicker } from './interests-picker';

const sameTopics = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** Profile card to change the chat topics (MODEL-066). */
export function InterestsCard({ user }: { user: AuthUser }) {
  const [selection, setSelection] = useState<string[]>(user.interests);
  const save = useUpdateInterests();
  const changed = !sameTopics(selection, user.interests);

  return (
    <section
      aria-labelledby="interests-title"
      className="rounded-2xl border border-border bg-surface p-6"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="interests-title" className="text-base font-semibold">
            Your topics
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            New chats suggest prompts based on these.
          </p>
        </div>
      </div>
      <div className="mt-5">
        <InterestsPicker value={selection} onChange={setSelection} />
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        <p role="status" className="text-xs text-muted-foreground">
          {save.isError
            ? save.error instanceof ApiError
              ? save.error.message
              : 'Your topics could not be saved.'
            : save.isSuccess && !changed
              ? 'Topics saved.'
              : ''}
        </p>
        <Button
          size="sm"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate({ interests: selection })}
        >
          {save.isPending ? 'Saving…' : 'Save topics'}
        </Button>
      </div>
    </section>
  );
}
