/** Code-split pages (see lazy-pages.tsx), loadable on demand or ahead of time. */
export const loaders = {
  sharedChatPage: () => import('@/pages/shared-chat-page'),
  comparePage: () => import('@/pages/compare-page'),
  modelsPage: () => import('@/pages/models-page'),
  imagePage: () => import('@/pages/image-page'),
  videoPage: () => import('@/pages/video-page'),
  settingsPage: () => import('@/pages/settings-page'),
  historyPage: () => import('@/pages/history-page'),
  conversationRunsPage: () => import('@/pages/conversation-runs-page'),
  comparisonDetailPage: () => import('@/pages/comparison-detail-page'),
  dashboardPage: () => import('@/pages/dashboard-page'),
};

/** Fetches every lazy page's code in the background; safe to call more than once. */
export function preloadPages(): void {
  for (const load of Object.values(loaders)) void load().catch(() => undefined);
}
