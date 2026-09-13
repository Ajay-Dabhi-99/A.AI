import { Navigate, Outlet, useLocation } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { currentUser, useMe } from '@/hooks/use-me';

/**
 * Route guard: signed-in users see the page, guests are sent to sign in and
 * brought back. Only a confirmed guest is redirected: if the session could not
 * be checked at all (offline, server error), sending them to a login form that
 * would fail the same way is misleading, so they get a retry instead.
 */
export function RequireUser() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <PageSpinner label="Checking your session" />;

  if (me.isError) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-5 py-20">
        <Alert tone="danger" title="We couldn't check your sign-in">
          {me.error.message}
        </Alert>
        <Button variant="secondary" onClick={() => void me.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (currentUser(me.data)) return <Outlet />;

  const next = encodeURIComponent(`${location.pathname}${location.search}`);
  return <Navigate to={`/login?next=${next}`} replace />;
}
