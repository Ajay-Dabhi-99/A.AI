import { APP_VERSION } from '../shared/constants/app.js';

/** Where an unexpected error happened. Identifiers only: never bodies, prompts or cookies. */
export type ErrorContext = {
  requestId?: string;
  method?: string;
  route?: string;
  source?: string;
};

/**
 * Sends unexpected errors to an error tracker (ADR-017). Without a DSN the
 * no-op reporter is used and nothing leaves the server.
 */
export interface ErrorReporter {
  readonly enabled: boolean;
  capture(error: unknown, context?: ErrorContext): void;
  /** Waits for queued reports before the process exits. */
  flush(timeoutMs: number): Promise<void>;
}

export const noopErrorReporter: ErrorReporter = {
  enabled: false,
  capture: () => undefined,
  flush: async () => undefined,
};

type ScrubbableEvent = {
  request?: {
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
    query_string?: unknown;
    url?: string;
  };
  user?: unknown;
  breadcrumbs?: unknown[];
  extra?: unknown;
};

/**
 * Removes everything that could carry personal data, secrets or prompts
 * before an event leaves the server: request headers, cookies, bodies, query
 * strings, user details, breadcrumbs and extra data. Stack traces and tags stay.
 */
export function scrubEvent<Event extends ScrubbableEvent>(event: Event): Event {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split('?')[0] as string;
  }
  delete event.user;
  delete event.extra;
  event.breadcrumbs = [];
  return event;
}

/** Sentry, loaded only when a DSN is configured. */
export async function createSentryReporter(options: {
  dsn: string;
  environment: string;
  release?: string;
}): Promise<ErrorReporter> {
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release ?? `a-ai-api@${APP_VERSION}`,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeSend: (event) => scrubEvent(event),
  });

  return {
    enabled: true,
    capture(error, context = {}) {
      Sentry.withScope((scope) => {
        for (const [key, value] of Object.entries(context)) {
          if (value !== undefined) scope.setTag(key, value);
        }
        Sentry.captureException(error);
      });
    },
    async flush(timeoutMs) {
      await Sentry.flush(timeoutMs);
    },
  };
}
