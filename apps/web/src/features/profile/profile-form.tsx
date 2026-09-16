import { zodResolver } from '@hookform/resolvers/zod';
import type { AuthUser } from '@a-ai/shared-types';
import {
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  profileFormSchema,
  toProfileUpdate,
} from '@a-ai/validation';
import { Check, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/features/auth/fields';
import { applyServerError } from '@/features/auth/form-errors';
import { useUpdateProfile } from '@/features/auth/use-auth-actions';

const valuesFor = (user: AuthUser) => ({
  firstName: user.firstName ?? '',
  lastName: user.lastName ?? '',
  phone: user.phone ?? '',
});

/** Name and phone, all optional: clearing a field removes it. */
export function ProfileForm({ user }: { user: AuthUser }) {
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(profileFormSchema),
    defaultValues: valuesFor(user),
  });
  const { errors, isDirty, isSubmitting } = form.formState;

  // Another tab can change the server copy; follow it.
  useEffect(() => {
    form.reset(valuesFor(user));
  }, [form, user]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      await update.mutateAsync(toProfileUpdate(values));
      // A refetch that returns identical data keeps the same object, so the
      // effect above may not run: mark the saved values as the new baseline.
      form.reset(values);
      setSaved(true);
    } catch (error) {
      setFormError(applyServerError(error, form.setError, ['firstName', 'lastName', 'phone']));
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="profile-form-title"
      className="overflow-hidden rounded-2xl border border-border bg-surface"
    >
      <div className="flex items-start gap-3 p-6 pb-0">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UserRound className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="profile-form-title" className="text-base font-semibold">
            Personal information
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            How your name appears in A.ai. Every field is optional.
          </p>
        </div>
      </div>

      <div className="space-y-5 p-6">
        {formError && <Alert tone="danger" title={formError} />}

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            id="profile-first-name"
            label="First name"
            autoComplete="given-name"
            maxLength={NAME_MAX_LENGTH}
            error={errors.firstName?.message}
            {...form.register('firstName')}
          />
          <TextField
            id="profile-last-name"
            label="Last name"
            autoComplete="family-name"
            maxLength={NAME_MAX_LENGTH}
            error={errors.lastName?.message}
            {...form.register('lastName')}
          />
        </div>

        <TextField
          id="profile-phone"
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={PHONE_MAX_LENGTH}
          hint="Include your country code, for example +91 98765 43210. Only you can see it, and it is never used to sign in."
          error={errors.phone?.message}
          {...form.register('phone')}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-muted/60 px-6 py-3.5">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {isDirty ? (
            'You have unsaved changes.'
          ) : saved ? (
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5 text-success" aria-hidden="true" />
              Profile saved
            </span>
          ) : (
            'Changes are saved to your account.'
          )}
        </p>
        <div className="flex gap-2">
          {isDirty && !isSubmitting && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                form.reset(valuesFor(user));
                setFormError(null);
              }}
            >
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
