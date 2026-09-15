import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AppProviders } from './app/providers';
import { router } from './app/router';
import { initErrorReporting } from './lib/error-reporting';
import './styles/globals.css';

// Loads the error tracker only when VITE_SENTRY_DSN is set; never blocks the first render.
void initErrorReporting();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
