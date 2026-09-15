import { webEnv } from './env';

type Reporter = { capture(error: unknown, context?: Record<string, string>): void };

let reporter: Reporter | null = null;

/**
 * Starts browser error reporting when VITE_SENTRY_DSN is set (ADR-017). The
 * SDK is loaded only then, sends no personal data, no breadcrumbs and no
 * query strings; without a DSN nothing is loaded or sent.
 */
export async function initErrorReporting(): Promise<void> {
  const dsn = webEnv.VITE_SENTRY_DSN;
  if (!dsn || reporter) return;
  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.split('?')[0];
      }
      event.breadcrumbs = [];
      return event;
    },
  });
  reporter = {
    capture: (error, context) =>
      Sentry.withScope((scope) => {
        if (context) scope.setTags(context);
        Sentry.captureException(error);
      }),
  };
}

/** Reports an unexpected client error; a no-op without a DSN. */
export function reportError(error: unknown, context?: Record<string, string>): void {
  reporter?.capture(error, context);
}
