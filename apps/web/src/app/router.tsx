import { createBrowserRouter, type RouteObject } from 'react-router';
import { LandingPage } from '@/pages/landing-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { RootLayout } from './root-layout';

/** Routes are added by the phase that implements them (blueprint §5 route table). */
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
