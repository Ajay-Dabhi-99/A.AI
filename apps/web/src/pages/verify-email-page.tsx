import { zodResolver } from '@hookform/resolvers/zod';
import { emailRequestSchema } from '@a-ai/validation';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Spinner } from '@/components/ui/spinner';
import { AuthLayout } from '@/features/auth/auth-layout';
import { TextField } from '@/features/auth/fields';
import { applyServerError } from '@/features/auth/form-errors';
import { useResendVerification, useVerifyEmail } from '@/features/auth/use-auth-actions';
import { useLinkToken } from '@/features/auth/use-link-token';

function RequestNewLink() {
  const resend = useResendVerification();
  const form = useForm({ resolver: zodResolver(emailRequestSchema), defaultValues: { email: '' } });
  const onSubmit = form.handleSubmit((values) => resend.mutate(values));

  if (resend.isSuccess) {
    return (
      <Alert tone="success" title="Check your inbox">
        If that account still needs verifying, a new link is on its way.
      </Alert>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {resend.isError && (
        <Alert
          tone="danger"
          title={
            applyServerError(resend.error, form.setError, ['email']) ?? 'Check the email address.'
          }
        />
      )}
      <TextField
        id="resend-email"
        label="Email"
        type="email"
        autoComplete="email"
        error={form.formState.errors.email?.message}
        {...form.register('email')}
      />
      <Button type="submit" className="w-full" disabled={resend.isPending}>
        {resend.isPending ? 'Sending…' : 'Send a new link'}
      </Button>
    </form>
  );
}

export function VerifyEmailPage() {
  const token = useLinkToken();
  const verify = useVerifyEmail();
  const { mutate } = verify;
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    mutate({ token });
  }, [token, mutate]);

  if (!token || verify.isError) {
    const message = token ? applyServerError(verify.error, () => undefined, []) : null;
    return (
      <AuthLayout
        title="This link doesn't work"
        description={message ?? 'The verification link is incomplete. Request a new one below.'}
      >
        <RequestNewLink />
      </AuthLayout>
    );
  }

  if (verify.isSuccess) {
    return (
      <AuthLayout
        title="Email verified"
        description={`You're signed in as ${verify.data.user.email}.`}
      >
        <Link to="/settings" className={buttonVariants({ size: 'lg', className: 'w-full' })}>
          Continue
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Verifying your email">
      <Spinner label="Checking your link…" />
    </AuthLayout>
  );
}
