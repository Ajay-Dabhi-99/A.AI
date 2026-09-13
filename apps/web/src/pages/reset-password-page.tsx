import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, passwordSchema } from '@a-ai/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/features/auth/auth-layout';
import { PasswordField } from '@/features/auth/fields';
import { applyServerError } from '@/features/auth/form-errors';
import { useResetPassword } from '@/features/auth/use-auth-actions';
import { useLinkToken } from '@/features/auth/use-link-token';
import { ApiError } from '@/services/api';

const resetFormSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords do not match',
  });

const requestNewLink = (
  <Link to="/forgot-password" className="font-medium text-primary hover:underline">
    Request a new reset link
  </Link>
);

export function ResetPasswordPage() {
  const token = useLinkToken();
  const navigate = useNavigate();
  const reset = useResetPassword();
  const [formError, setFormError] = useState<{ message: string; expired: boolean } | null>(null);
  const form = useForm({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (!token) {
    return (
      <AuthLayout title="This link doesn't work" footer={requestNewLink}>
        <Alert tone="danger" title="The reset link is incomplete or has already been used." />
      </AuthLayout>
    );
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await reset.mutateAsync({ token, password });
      navigate('/settings', { replace: true, state: { passwordReset: true } });
    } catch (error) {
      const message = applyServerError(error, form.setError, ['password']);
      if (message) {
        setFormError({
          message,
          expired: error instanceof ApiError && error.code === 'TOKEN_INVALID',
        });
      }
    }
  });

  return (
    <AuthLayout
      title="Choose a new password"
      description="You'll be signed out on every other device."
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && (
          <Alert tone="danger" title={formError.message}>
            {formError.expired && requestNewLink}
          </Alert>
        )}
        <PasswordField
          id="reset-password"
          label="New password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <PasswordField
          id="reset-confirm"
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
