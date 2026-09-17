import { Suspense, useEffect } from 'react';
import { Outlet, ScrollRestoration } from 'react-router';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { PageSpinner } from '@/components/ui/spinner';
import { preloadPages } from './page-loaders';

export function RootLayout() {
  useEffect(() => {
    // After the first page is on screen, fetch the other pages' code in the background.
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preloadPages, { timeout: 4_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preloadPages, 1_500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* Pages outside the main chat flow load on demand (Phase 10 performance). */}
        <Suspense fallback={<PageSpinner label="Loading page" />}>
          <Outlet />
        </Suspense>
      </main>
      <SiteFooter />
      <ScrollRestoration />
    </div>
  );
}
