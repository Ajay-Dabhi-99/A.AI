import { createBrowserRouter, type RouteObject } from 'react-router';
import { ChatPage } from '@/pages/chat-page';
import { ErrorPage } from '@/pages/error-page';
import { ForgotPasswordPage } from '@/pages/forgot-password-page';
import { LandingPage } from '@/pages/landing-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { ResetPasswordPage } from '@/pages/reset-password-page';
import { SignupPage } from '@/pages/signup-page';
import { VerifyEmailPage } from '@/pages/verify-email-page';
import {
  ComparePage,
  ComparisonDetailPage,
  ConversationRunsPage,
  DashboardPage,
  HistoryPage,
  ImagePage,
  ModelsPage,
  SettingsPage,
  SharedChatPage,
  VideoPage,
} from './lazy-pages';
import { RequireUser } from './require-user';
import { RootLayout } from './root-layout';

/** Routes are added by the phase that implements them (blueprint §5 route table). */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    // A page that crashes shows a recovery screen instead of a blank app (Phase 10).
    errorElement: <ErrorPage />,
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
      // Public read-only snapshot of a chat (MODEL-070).
      { path: 'share/:token', element: <SharedChatPage /> },
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
