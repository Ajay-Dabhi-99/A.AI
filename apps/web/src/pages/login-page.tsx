import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema } from '@a-ai/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/features/auth/auth-layout';
import { PasswordField, TextField } from '@/features/auth/fields';
import { applyServerError, safeRedirectPath } from '@/features/auth/form-errors';
import { useLogin, useResendVerification } from '@/features/auth/use-auth-actions';
import { currentUser, useMe } from '@/hooks/use-me';
import { ApiError } from '@/services/api';

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeRedirectPath(params.get('next'));
  const navigate = useNavigate();
  const me = useMe();
  const login = useLogin();
  const resend = useResendVerification();
  const [formError, setFormError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (currentUser(me.data)) return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setUnverifiedEmail(null);
    resend.reset();
    try {
      await login.mutateAsync(values);
      navigate(next, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(values.email);
      }
      setFormError(applyServerError(error, form.setError, ['email', 'password']));
    }
  });

  return (
    <AuthLayout
      title="Welcome back"
      description="Sign in to keep your conversations and comparisons."
      footer={
        <>
          New to A.ai?{' '}
          <Link to="/signup" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && (
          <Alert tone="danger" title={formError}>
            {unverifiedEmail &&
              (resend.isSuccess ? (
                <p>A new verification link is on its way to {unverifiedEmail}.</p>
              ) : (
                <button
                  type="button"
                  className="font-medium text-primary hover:underline disabled:opacity-60"
                  disabled={resend.isPending}
                  onClick={() => resend.mutate({ email: unverifiedEmail })}
                >
                  {resend.isPending ? 'Sending…' : 'Send a new verification link'}
                </button>
              ))}
          </Alert>
        )}

        <TextField
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <PasswordField
          id="login-password"
          label="Password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
