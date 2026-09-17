import { useState } from 'react';
import { useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useUpdateInterests } from '@/features/auth/use-auth-actions';
import { currentUser, useMe } from '@/hooks/use-me';
import { ApiError } from '@/services/api';
import { InterestsPicker } from './interests-picker';

/** Pages where asking would get in the way of finishing an account flow. */
const QUIET_PATHS = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password'];

/**
 * Asks a signed-in user once for up to three topics (MODEL-066). Saving or
 * skipping records the answer, so the question is not asked again.
 */
export function InterestsDialog() {
  const me = useMe();
  const { pathname } = useLocation();
  const user = currentUser(me.data);
  const [selection, setSelection] = useState<string[]>([]);
  const save = useUpdateInterests();
  const open =
    user !== null &&
    user.interestsSetAt === null &&
    !QUIET_PATHS.includes(pathname) &&
    !pathname.startsWith('/share/');

  const submit = (interests: string[]) => save.mutate({ interests });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !save.isPending && submit([])}>
      <DialogContent
        title="What are you interested in?"
        description="Pick up to three topics and we'll suggest prompts for them in chat. You can change them later in your profile."
        className="max-w-lg"
      >
        <div className="mt-5">
          <InterestsPicker value={selection} onChange={setSelection} />
        </div>
        {save.isError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {save.error instanceof ApiError
              ? save.error.message
              : 'Your topics could not be saved. Try again.'}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={save.isPending} onClick={() => submit([])}>
            Skip for now
          </Button>
          <Button
            disabled={save.isPending || selection.length === 0}
            onClick={() => submit(selection)}
          >
            {save.isPending ? 'Saving…' : 'Save topics'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
