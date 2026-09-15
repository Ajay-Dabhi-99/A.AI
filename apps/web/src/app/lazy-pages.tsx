import { lazy } from 'react';

// Landing, auth and chat stay in the first download; these pages load when opened
// (Phase 10 performance). RootLayout shows a spinner while a page's code arrives.

export const ComparePage = lazy(() =>
  import('@/pages/compare-page').then((module) => ({ default: module.ComparePage })),
);

export const ModelsPage = lazy(() =>
  import('@/pages/models-page').then((module) => ({ default: module.ModelsPage })),
);

export const ImagePage = lazy(() =>
  import('@/pages/image-page').then((module) => ({ default: module.ImagePage })),
);

export const VideoPage = lazy(() =>
  import('@/pages/video-page').then((module) => ({ default: module.VideoPage })),
);

export const SettingsPage = lazy(() =>
  import('@/pages/settings-page').then((module) => ({ default: module.SettingsPage })),
);

export const HistoryPage = lazy(() =>
  import('@/pages/history-page').then((module) => ({ default: module.HistoryPage })),
);

export const ConversationRunsPage = lazy(() =>
  import('@/pages/conversation-runs-page').then((module) => ({
    default: module.ConversationRunsPage,
  })),
);

export const ComparisonDetailPage = lazy(() =>
  import('@/pages/comparison-detail-page').then((module) => ({
    default: module.ComparisonDetailPage,
  })),
);

export const DashboardPage = lazy(() =>
  import('@/pages/dashboard-page').then((module) => ({ default: module.DashboardPage })),
);
