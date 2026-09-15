import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Pages load on demand in the app (router lazy pages). Compiling them up front keeps a
// test's first render from racing the module transform when the machine is busy.
await Promise.all([
  import('./src/pages/compare-page'),
  import('./src/pages/models-page'),
  import('./src/pages/image-page'),
  import('./src/pages/video-page'),
  import('./src/pages/settings-page'),
  import('./src/pages/history-page'),
  import('./src/pages/conversation-runs-page'),
  import('./src/pages/comparison-detail-page'),
  import('./src/pages/dashboard-page'),
]);

// findBy* queries wait longer than the 1 s default under parallel CI load.
configure({ asyncUtilTimeout: 3_000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // storage unavailable in this environment
  }
  delete document.documentElement.dataset.theme;
});

/** jsdom has no matchMedia; tests override `matches` per query when needed. */
export function mockMatchMedia(matching: (query: string) => boolean = () => false): void {
  window.matchMedia = (query: string) =>
    ({
      matches: matching(query),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
mockMatchMedia();

// jsdom does not implement scrolling; React Router's <ScrollRestoration> calls it.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  readonly scrollMargin = '0px';
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
globalThis.IntersectionObserver ??= TestIntersectionObserver;
