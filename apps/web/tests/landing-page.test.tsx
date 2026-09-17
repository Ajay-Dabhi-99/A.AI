import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { baseRoutes, jsonResponse, mockApi, readyReport, renderApp } from './helpers/render';

describe('landing page', () => {
  it('renders the hero, feature and how-it-works sections', async () => {
    mockApi(baseRoutes);
    renderApp('/');

    expect(
      screen.getByRole('heading', { level: 1, name: /put ai models in the ring/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /everything you need to pick the right model/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /three steps from question to decision/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/illustrative preview, not a benchmark/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('All systems operational')).toHaveLength(1));
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      /© \d{4} A\.ai\. All rights reserved\.\s*Developed by Ajay Dabhi/,
    );
  });

  it('shows a partial outage when readiness returns 503', async () => {
    mockApi({
      ...baseRoutes,
      '/ready': () =>
        jsonResponse(
          {
            ...readyReport,
            status: 'not_ready',
            checks: {
              ...readyReport.checks,
              redis: { status: 'down', latencyMs: 2000, error: 'timed out after 2000ms' },
            },
          },
          503,
        ),
    });
    renderApp('/');
    await waitFor(() => expect(screen.getAllByText('Partial outage')).toHaveLength(1));
    expect(screen.getAllByText('Partial outage')[0]?.closest('[role="status"]')).toHaveAttribute(
      'title',
      expect.stringContaining('Redis: down'),
    );
  });

  it('shows the API as unreachable when requests fail, and still offers sign in', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    renderApp('/');
    await waitFor(() => expect(screen.getAllByText('API unreachable')).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('renders a 404 page for unknown routes', () => {
    mockApi(baseRoutes);
    renderApp('/does-not-exist');
    expect(screen.getByRole('heading', { name: /this page does not exist/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});
