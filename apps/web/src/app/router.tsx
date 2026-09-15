import { createBrowserRouter, type RouteObject } from 'react-router';
import { ChatPage } from '@/pages/chat-page';
import { ComparePage } from '@/pages/compare-page';
import { ComparisonDetailPage } from '@/pages/comparison-detail-page';
import { ConversationRunsPage } from '@/pages/conversation-runs-page';
import { DashboardPage } from '@/pages/dashboard-page';
import { HistoryPage } from '@/pages/history-page';
import { ImagePage } from '@/pages/image-page';
import { ForgotPasswordPage } from '@/pages/forgot-password-page';
import { LandingPage } from '@/pages/landing-page';
import { LoginPage } from '@/pages/login-page';
import { ModelsPage } from '@/pages/models-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { ResetPasswordPage } from '@/pages/reset-password-page';
import { SettingsPage } from '@/pages/settings-page';
import { SignupPage } from '@/pages/signup-page';
import { VerifyEmailPage } from '@/pages/verify-email-page';
import { VideoPage } from '@/pages/video-page';
import { RequireUser } from './require-user';
import { RootLayout } from './root-layout';

/** Routes are added by the phase that implements them (blueprint §5 route table). */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      // Guests and users; saved conversations (/chat/:id) need an account.
      { path: 'chat', element: <ChatPage /> },
      { path: 'chat/:conversationId', element: <ChatPage /> },
      // Guests (2 models) and users (4 models); results are streamed side by side.
      { path: 'compare', element: <ComparePage /> },
      // Public catalog; admin controls appear for administrators.
      { path: 'models', element: <ModelsPage /> },
      // Says plainly when no image provider is enabled; generating needs an account (Phase 8).
      { path: 'image', element: <ImagePage /> },
      // Video jobs resume from ?job=<id> after a refresh (Phase 9).
      { path: 'video', element: <VideoPage /> },
      {
        element: <RequireUser />,
        children: [
          { path: 'settings', element: <SettingsPage /> },
          // Saved history, run detail and usage analytics (Phase 7).
          { path: 'history', element: <HistoryPage /> },
          { path: 'history/chats/:conversationId', element: <ConversationRunsPage /> },
          { path: 'history/comparisons/:comparisonId', element: <ComparisonDetailPage /> },
          { path: 'dashboard', element: <DashboardPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
