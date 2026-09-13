import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH, signupRequestSchema } from '@a-ai/validation';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/features/auth/auth-layout';
import { PasswordField, TextField } from '@/features/auth/fields';
import { applyServerError } from '@/features/auth/form-errors';
import { useResendVerification, useSignup } from '@/features/auth/use-auth-actions';
import { currentUser, useMe } from '@/hooks/use-me';

export function SignupPage() {
  const me = useMe();
  const signup = useSignup();
  const resend = useResendVerification();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (currentUser(me.data)) return <Navigate to="/settings" replace />;

  if (sentTo) {
    return (
      <AuthLayout title="Check your inbox">
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MailCheck className="size-5" aria-hidden="true" />
            </span>
            <p className="text-sm text-muted-foreground">
              We sent a verification link to{' '}
              <span className="font-medium text-foreground">{sentTo}</span>. Open it to finish
              creating your account. The link expires in 24 hours.
            </p>
          </div>
          {resend.isSuccess && <Alert tone="success" title="A new link is on its way." />}
          {resend.isError && (
            <Alert
              tone="danger"
              title={applyServerError(resend.error, () => undefined, []) ?? ''}
            />
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={resend.isPending}
              onClick={() => resend.mutate({ email: sentTo })}
            >
              {resend.isPending ? 'Sending…' : 'Resend the link'}
            </Button>
            <Button variant="ghost" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signup.mutateAsync(values);
      resend.reset();
      setSentTo(values.email);
    } catch (error) {
      setFormError(applyServerError(error, form.setError, ['email', 'password']));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      description="Save your history and get a higher daily limit than guest mode."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="danger" title={formError} />}
        <TextField
          id="signup-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <PasswordField
          id="signup-password"
          label="Password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easier to remember.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
