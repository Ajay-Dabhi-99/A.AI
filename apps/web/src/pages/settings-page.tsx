import type { AuthUser, QuotaSummary } from '@a-ai/shared-types';
import {
  BadgeCheck,
  CalendarDays,
  CircleCheck,
  Gauge,
  LogOut,
  MonitorSmartphone,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { applyServerError } from '@/features/auth/form-errors';
import { useLogout, useLogoutEverywhere } from '@/features/auth/use-auth-actions';
import { displayName, initials, profileCompletion } from '@/features/profile/identity';
import { ProfileForm } from '@/features/profile/profile-form';
import { currentUser, useMe } from '@/hooks/use-me';
import { cn } from '@/lib/utils';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-2 overflow-hidden rounded-full border border-border bg-surface-muted"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="ml-auto min-w-0 truncate text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

function CardHeading({
  id,
  icon: Icon,
  title,
  description,
}: {
  id: string;
  icon: typeof Phone;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function IdentityCard({ user }: { user: AuthUser }) {
  const hasName = Boolean(user.firstName || user.lastName);
  const completion = profileCompletion(user);
  const complete = completion.done === completion.total;

  return (
    <section
      aria-label="Account summary"
      className="rounded-2xl border border-border bg-surface p-6 lg:sticky lg:top-20"
    >
      <div className="flex flex-col items-center text-center">
        <span className="rounded-full bg-gradient-to-br from-primary to-primary-hover p-[3px] shadow-sm">
          <span className="grid size-20 place-items-center rounded-full bg-surface">
            <span className="grid size-[4.25rem] place-items-center rounded-full bg-gradient-to-br from-primary to-primary-hover text-2xl font-semibold tracking-wide text-primary-foreground">
              {initials(user)}
            </span>
          </span>
        </span>

        <p className="mt-4 max-w-full truncate text-lg font-semibold">
          {hasName ? displayName(user) : <span className="text-muted-foreground">No name yet</span>}
        </p>
        <p className="max-w-full truncate text-sm text-muted-foreground">{user.email}</p>

        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {user.emailVerified ? (
            <Badge tone="success">
              <BadgeCheck className="size-3.5" aria-hidden="true" />
              Verified
            </Badge>
          ) : (
            <Badge>Not verified</Badge>
          )}
          {user.role === 'admin' && <Badge tone="primary">Admin</Badge>}
        </div>
      </div>

      <dl className="mt-6 divide-y divide-border border-y border-border">
        <InfoRow icon={Phone} label="Phone">
          {user.phone ?? <span className="font-normal text-muted-foreground">Not added yet</span>}
        </InfoRow>
        <InfoRow icon={CalendarDays} label="Member since">
          {dateFormat.format(new Date(user.createdAt))}
        </InfoRow>
      </dl>

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">Profile completion</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              complete ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {complete && <CircleCheck className="size-3.5" aria-hidden="true" />}
            {completion.done} of {completion.total} details
          </span>
        </div>
        <Meter value={completion.done} max={completion.total} label="Profile completion" />
        {!complete && (
          <p className="text-xs text-muted-foreground">
            Add your name and phone number to complete your profile.
          </p>
        )}
      </div>
    </section>
  );
}

function UsageCard({ quota }: { quota: QuotaSummary }) {
  return (
    <section
      aria-labelledby="usage-title"
      className="rounded-2xl border border-border bg-surface p-6"
    >
      <CardHeading
        id="usage-title"
        icon={Gauge}
        title="Today's usage"
        description={`Messages you can send today. Resets at ${timeFormat.format(new Date(quota.resetsAt))}.`}
      />
      <div className="mt-5 flex items-end justify-between gap-4">
        <p className="text-4xl font-semibold tracking-tight tabular-nums">
          {quota.used}
          <span className="ml-1.5 text-base font-normal tracking-normal text-muted-foreground">
            / {quota.limit} messages
          </span>
        </p>
        <p className="pb-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{quota.remaining}</span> left
        </p>
      </div>
      <div className="mt-3">
        <Meter value={quota.used} max={quota.limit} label="Daily message allowance used" />
      </div>
    </section>
  );
}

function SecurityRow({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Phone;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="shrink-0 pl-7 sm:pl-0">{action}</div>
    </div>
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
  const actionError = logout.error ?? logoutEverywhere.error;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Your profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal details, daily usage and account security.
        </p>
      </header>

      {(passwordReset || actionError) && (
        <div className="mt-6 space-y-3">
          {passwordReset && (
            <Alert tone="success" title="Password updated">
              Every other device has been signed out.
            </Alert>
          )}
          {actionError && (
            <Alert tone="danger" title={applyServerError(actionError, () => undefined, []) ?? ''} />
          )}
        </div>
      )}

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <IdentityCard user={user} />

        <div className="min-w-0 space-y-6">
          <UsageCard quota={data.quota} />
          <ProfileForm user={user} />

          <section
            aria-labelledby="security-title"
            className="rounded-2xl border border-border bg-surface p-6"
          >
            <CardHeading
              id="security-title"
              icon={ShieldCheck}
              title="Security"
              description="Control where your account is signed in."
            />
            <div className="mt-2 divide-y divide-border">
              <SecurityRow
                icon={LogOut}
                title="Sign out of this device"
                description="Ends the session in this browser only."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={logout.isPending}
                    onClick={() =>
                      logout.mutate(undefined, {
                        onSuccess: () => navigate('/', { replace: true }),
                      })
                    }
                  >
                    {logout.isPending ? 'Signing out…' : 'Sign out'}
                  </Button>
                }
              />
              <SecurityRow
                icon={MonitorSmartphone}
                title="Sign out of all devices"
                description="Use this if you signed in on a device you no longer use. It signs you out here too."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    className="border-danger/40 text-danger hover:bg-danger/10"
                    disabled={logoutEverywhere.isPending}
                    onClick={() =>
                      logoutEverywhere.mutate(undefined, {
                        onSuccess: () => navigate('/login', { replace: true }),
                      })
                    }
                  >
                    {logoutEverywhere.isPending ? 'Signing out…' : 'Sign out everywhere'}
                  </Button>
                }
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
