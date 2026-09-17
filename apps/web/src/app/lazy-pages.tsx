import { lazy } from 'react';
import { loaders } from './page-loaders';

// Landing, auth and chat stay in the first download; these pages load when opened
// (Phase 10 performance). RootLayout shows a spinner while a page's code arrives,
// and preloads every page once the browser is idle so switching pages does not flash it.

export const SharedChatPage = lazy(() =>
  loaders.sharedChatPage().then((module) => ({ default: module.SharedChatPage })),
);

export const ComparePage = lazy(() =>
  loaders.comparePage().then((module) => ({ default: module.ComparePage })),
);

export const ModelsPage = lazy(() =>
  loaders.modelsPage().then((module) => ({ default: module.ModelsPage })),
);

export const ImagePage = lazy(() =>
  loaders.imagePage().then((module) => ({ default: module.ImagePage })),
);

export const VideoPage = lazy(() =>
  loaders.videoPage().then((module) => ({ default: module.VideoPage })),
);

export const SettingsPage = lazy(() =>
  loaders.settingsPage().then((module) => ({ default: module.SettingsPage })),
);

export const HistoryPage = lazy(() =>
  loaders.historyPage().then((module) => ({ default: module.HistoryPage })),
);

export const ConversationRunsPage = lazy(() =>
  loaders.conversationRunsPage().then((module) => ({
    default: module.ConversationRunsPage,
  })),
);

export const ComparisonDetailPage = lazy(() =>
  loaders.comparisonDetailPage().then((module) => ({
    default: module.ComparisonDetailPage,
  })),
);

export const DashboardPage = lazy(() =>
  loaders.dashboardPage().then((module) => ({ default: module.DashboardPage })),
);
