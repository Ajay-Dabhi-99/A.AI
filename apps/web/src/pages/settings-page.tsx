import { LogOut } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { applyServerError } from '@/features/auth/form-errors';
import { useLogout, useLogoutEverywhere } from '@/features/auth/use-auth-actions';
import { currentUser, useMe } from '@/hooks/use-me';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Rendered inside <RequireUser>, so a signed-in user is guaranteed. */
export function SettingsPage() {
  const { data } = useMe();
  const user = currentUser(data);
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const logoutEverywhere = useLogoutEverywhere();
  const passwordReset = (location.state as { passwordReset?: boolean } | null)?.passwordReset;

  if (!user || !data) return null;
  const { quota } = data;
  const actionError = logout.error ?? logoutEverywhere.error;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your account and security.</p>
      </div>

      {passwordReset && (
        <Alert tone="success" title="Password updated">
          Every other device has been signed out.
        </Alert>
      )}
      {actionError && (
        <Alert tone="danger" title={applyServerError(actionError, () => undefined, []) ?? ''} />
      )}

      <Section title="Account">
        <dl className="grid gap-4 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="flex flex-wrap items-center gap-2 break-all">
            {user.email}
            {user.emailVerified ? (
              <Badge tone="success">Verified</Badge>
            ) : (
              <Badge>Not verified</Badge>
            )}
          </dd>
          <dt className="text-muted-foreground">Member since</dt>
          <dd>{dateFormat.format(new Date(user.createdAt))}</dd>
          <dt className="text-muted-foreground">Messages today</dt>
          <dd>
            <span className="font-mono tabular-nums">
              {quota.used} / {quota.limit}
            </span>
            <span className="text-muted-foreground">
              {' '}
              · resets at {timeFormat.format(new Date(quota.resetsAt))}
            </span>
          </dd>
        </dl>
      </Section>

      <Section title="Sessions">
        <p className="text-sm text-muted-foreground">
          Signing out everywhere ends every session, including this one. Use it if you signed in on
          a device you no longer use.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, { onSuccess: () => navigate('/', { replace: true }) })
            }
          >
            <LogOut aria-hidden="true" />
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </Button>
          <Button
            variant="ghost"
            disabled={logoutEverywhere.isPending}
            onClick={() =>
              logoutEverywhere.mutate(undefined, {
                onSuccess: () => navigate('/login', { replace: true }),
              })
            }
          >
            {logoutEverywhere.isPending ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
        </div>
      </Section>
    </div>
  );
}
