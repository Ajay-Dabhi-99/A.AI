import { useEffect } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/error-reporting';

/** Shown when a page crashes while rendering or loading (Phase 10). */
export function ErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  useEffect(() => {
    if (!notFound) reportError(error, { source: 'route' });
  }, [error, notFound]);

  return (
    <div
      role="alert"
      className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-5 text-center"
    >
      <h1 className="text-2xl font-semibold tracking-tight">
        {notFound ? 'Page not found' : 'Something went wrong'}
      </h1>
      <p className="text-sm text-muted-foreground">
        {notFound
          ? 'This page does not exist.'
          : 'This page hit an unexpected error. Reloading usually fixes it; if not, try again in a minute.'}
      </p>
      <div className="flex items-center gap-3">
        {!notFound && <Button onClick={() => window.location.reload()}>Reload</Button>}
        <Link to="/" className="text-sm font-medium text-primary hover:underline">
          Go to the home page
        </Link>
      </div>
    </div>
  );
}
