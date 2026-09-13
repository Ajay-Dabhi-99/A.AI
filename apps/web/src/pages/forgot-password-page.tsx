import { zodResolver } from '@hookform/resolvers/zod';
import { emailRequestSchema } from '@a-ai/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/features/auth/auth-layout';
import { TextField } from '@/features/auth/fields';
import { applyServerError } from '@/features/auth/form-errors';
import { useForgotPassword } from '@/features/auth/use-auth-actions';

export function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(emailRequestSchema), defaultValues: { email: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await forgot.mutateAsync(values);
      setSentTo(values.email);
    } catch (error) {
      setFormError(applyServerError(error, form.setError, ['email']));
    }
  });

  const backToLogin = (
    <Link to="/login" className="font-medium text-primary hover:underline">
      Back to sign in
    </Link>
  );

  if (sentTo) {
    return (
      <AuthLayout title="Check your inbox" footer={backToLogin}>
        <Alert tone="success" title="Reset link sent">
          If an account exists for {sentTo}, we sent a link to choose a new password. It expires in
          1 hour.
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your account email and we'll send you a link to choose a new password."
      footer={backToLogin}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger" title={formError} />}
        <TextField
          id="forgot-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthLayout>
  );
}
