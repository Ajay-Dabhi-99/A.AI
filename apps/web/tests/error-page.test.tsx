import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportError } from '../src/lib/error-reporting';
import { ErrorPage } from '../src/pages/error-page';

vi.mock('../src/lib/error-reporting', () => ({
  reportError: vi.fn(),
  initErrorReporting: vi.fn(),
}));

function Broken(): never {
  throw new Error('render failed');
}

afterEach(() => {
  vi.mocked(reportError).mockClear();
});

describe('error page', () => {
  it('replaces a crashed page with a recovery message and reports the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const router = createMemoryRouter([
      { path: '/', element: <Broken />, errorElement: <ErrorPage /> },
    ]);
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'render failed' }),
      { source: 'route' },
    );
    vi.mocked(console.error).mockRestore();
  });

  it('does not report a missing page', async () => {
    const router = createMemoryRouter(
      [{ path: '/', element: <p>home</p>, errorElement: <ErrorPage /> }],
      {
        initialEntries: ['/missing'],
      },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(reportError).not.toHaveBeenCalled();
  });
});
