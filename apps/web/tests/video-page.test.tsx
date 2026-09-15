import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baseRoutes,
  callsTo,
  errorResponse,
  jsonResponse,
  mockApi,
  renderApp,
  userMe,
} from './helpers/render';

const JOB_ID = '7a2c9e41-0b5d-4f3a-8c61-2e9d4b7f1a03';

const video = {
  id: '9c1e5b7a-3d2f-4a60-8b19-5f7e2c4d6a81',
  kind: 'video',
  mimeType: 'video/mp4',
  sizeBytes: 4_096_000,
  width: null,
  height: null,
  fileName: null,
  source: 'generated',
  createdAt: '2026-09-17T10:04:00.000Z',
};

const processing = {
  id: JOB_ID,
  kind: 'video',
  status: 'processing',
  provider: 'reels',
  model: 'reel-1',
  prompt: 'a paper boat on a river',
  progress: 0.3,
  errorCode: null,
  attachment: null,
  createdAt: '2026-09-17T10:00:00.000Z',
  completedAt: null,
};

const completed = {
  ...processing,
  status: 'completed',
  progress: 1,
  attachment: video,
  completedAt: '2026-09-17T10:04:00.000Z',
};

const earlier = {
  ...completed,
  id: '1f3b5d7e-9a2c-4e6f-8b0d-2c4e6a8b0d1f',
  prompt: 'fireworks over a lake',
};

function jobEvents(snapshots: object[], init?: RequestInit, options: { hang?: boolean } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const job of snapshots) {
        controller.enqueue(encoder.encode(`event: job\ndata: ${JSON.stringify(job)}\n\n`));
      }
      if (!options.hang) {
        controller.close();
        return;
      }
      init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), {
        once: true,
      });
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const enabledRoutes = {
  ...baseRoutes,
  '/api/me': () => jsonResponse(userMe),
  'GET /api/video/status': () =>
    jsonResponse({
      enabled: true,
      models: [{ provider: 'reels', model: 'reel-1', name: 'Reels 1' }],
    }),
  'GET /api/jobs': () => jsonResponse({ jobs: [completed, earlier] }),
  [`GET /api/attachments/${video.id}/url`]: () =>
    jsonResponse({
      url: 'https://storage.test/signed/boat.mp4?token=t',
      expiresAt: '2026-09-17T10:09:00.000Z',
    }),
};

afterEach(() => {
  vi.useRealTimers();
});

describe('video page', () => {
  it('says plainly that video generation is not enabled', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/video/status': () => jsonResponse({ enabled: false, models: [] }),
    });
    renderApp('/video');
    expect(
      await screen.findByText('Video generation is not enabled on this deployment'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Describe the video')).not.toBeInTheDocument();
  });

  it('resumes a job from the address after a refresh and plays the result', async () => {
    const api = mockApi({
      ...enabledRoutes,
      [`GET /api/jobs/${JOB_ID}`]: () => jsonResponse({ job: processing }),
      [`GET /api/jobs/${JOB_ID}/events`]: () =>
        jobEvents([{ ...processing, progress: 0.8 }, completed]),
    });
    renderApp(`/video?job=${JOB_ID}`);

    expect(await screen.findByLabelText('Generated video')).toHaveAttribute(
      'src',
      'https://storage.test/signed/boat.mp4?token=t',
    );
    expect(
      within(screen.getByRole('region', { name: 'Current job' })).getByRole('status'),
    ).toHaveTextContent('Done');
    // Other recent jobs stay one click away.
    expect(screen.getByRole('link', { name: 'fireworks over a lake' })).toHaveAttribute(
      'href',
      `/video?job=${earlier.id}`,
    );
    expect(callsTo(api, `GET /api/jobs/${JOB_ID}`)).toHaveLength(1);
  });

  it('shows progress, reconnects, then polls when the event stream keeps failing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let polls = 0;
    const api = mockApi({
      ...enabledRoutes,
      [`GET /api/jobs/${JOB_ID}`]: () => {
        polls += 1;
        return jsonResponse({ job: polls === 1 ? processing : completed });
      },
      [`GET /api/jobs/${JOB_ID}/events`]: () =>
        errorResponse(503, 'MODEL_UNAVAILABLE', 'Streaming is unavailable'),
    });
    renderApp(`/video?job=${JOB_ID}`);

    expect(
      await screen.findByRole('progressbar', { name: 'Video generation progress' }),
    ).toHaveAttribute('aria-valuenow', '30');
    expect(await screen.findByText('Connection lost. Reconnecting…')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 3_000 + 500);
    expect(await screen.findByLabelText('Generated video')).toBeInTheDocument();
    // One stream attempt plus three reconnects, then polling took over.
    expect(callsTo(api, `GET /api/jobs/${JOB_ID}/events`)).toHaveLength(4);
  });

  it('cancels a running job', async () => {
    const api = mockApi({
      ...enabledRoutes,
      [`GET /api/jobs/${JOB_ID}`]: () => jsonResponse({ job: processing }),
      [`GET /api/jobs/${JOB_ID}/events`]: (init) => jobEvents([processing], init, { hang: true }),
      [`POST /api/jobs/${JOB_ID}/cancel`]: () =>
        jsonResponse({
          job: {
            ...processing,
            status: 'cancelled',
            progress: null,
            completedAt: '2026-09-17T10:01:00.000Z',
          },
        }),
    });
    renderApp(`/video?job=${JOB_ID}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Current job' })).getByRole('status'),
      ).toHaveTextContent('Cancelled'),
    );
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(callsTo(api, `POST /api/jobs/${JOB_ID}/cancel`)).toHaveLength(1);
  });
});
