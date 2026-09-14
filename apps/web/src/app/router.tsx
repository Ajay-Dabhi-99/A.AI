import { createBrowserRouter, type RouteObject } from 'react-router';
import { ChatPage } from '@/pages/chat-page';
import { ForgotPasswordPage } from '@/pages/forgot-password-page';
import { LandingPage } from '@/pages/landing-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { ResetPasswordPage } from '@/pages/reset-password-page';
import { SettingsPage } from '@/pages/settings-page';
import { SignupPage } from '@/pages/signup-page';
import { VerifyEmailPage } from '@/pages/verify-email-page';
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
      {
        element: <RequireUser />,
        children: [{ path: 'settings', element: <SettingsPage /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
