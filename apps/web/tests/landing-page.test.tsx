import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, readyReport, renderApp } from './helpers/render';

describe('landing page', () => {
  it('renders the hero, feature and how-it-works sections', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(readyReport));
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
    await waitFor(() => expect(screen.getAllByText('All systems operational')).toHaveLength(2));
  });

  it('shows a partial outage when readiness returns 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    );
    renderApp('/');
    await waitFor(() => expect(screen.getAllByText('Partial outage')).toHaveLength(2));
    expect(screen.getAllByRole('status')[0]).toHaveAttribute(
      'title',
      expect.stringContaining('Redis: down'),
    );
  });

  it('shows the API as unreachable when the request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    renderApp('/');
    await waitFor(() => expect(screen.getAllByText('API unreachable')).toHaveLength(2));
  });

  it('renders a 404 page for unknown routes', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(readyReport));
    renderApp('/does-not-exist');
    expect(screen.getByRole('heading', { name: /this page does not exist/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});
