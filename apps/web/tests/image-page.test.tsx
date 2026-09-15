import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { baseRoutes, callsTo, jsonResponse, mockApi, renderApp, userMe } from './helpers/render';

const attachment = {
  id: '5b0a4c7e-8f5e-4c2a-9d7b-2f1e6a3c9b10',
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 2048,
  width: 512,
  height: 512,
  fileName: null,
  source: 'generated',
  createdAt: '2026-09-16T10:00:05.000Z',
};

const job = {
  id: '0d7f1f6c-3b7a-4e0e-9a51-6b8f2c4d1e22',
  status: 'queued',
  provider: 'pixels',
  model: 'pix-1',
  prompt: 'a red fox',
  errorCode: null,
  attachment: null,
  createdAt: '2026-09-16T10:00:00.000Z',
  completedAt: null,
};

describe('image page', () => {
  it('says plainly that image generation is not enabled', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/image/status': () => jsonResponse({ enabled: false, models: [] }),
    });
    renderApp('/image');

    expect(
      await screen.findByText('Image generation is not enabled on this deployment'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument();
  });

  it('starts a job and shows the finished image', async () => {
    const api = mockApi({
      ...baseRoutes,
      '/api/me': () => jsonResponse(userMe),
      'GET /api/image/status': () =>
        jsonResponse({
          enabled: true,
          models: [{ provider: 'pixels', model: 'pix-1', name: 'Pixels 1' }],
        }),
      'POST /api/image/generate': () => jsonResponse({ job }, 202),
      [`GET /api/image/${job.id}`]: () =>
        jsonResponse({
          job: { ...job, status: 'completed', attachment, completedAt: '2026-09-16T10:00:05.000Z' },
        }),
      [`GET /api/attachments/${attachment.id}/url`]: () =>
        jsonResponse({
          url: 'https://storage.test/signed/fox.png?token=t',
          expiresAt: '2026-09-16T10:05:00.000Z',
        }),
    });
    renderApp('/image');

    fireEvent.change(await screen.findByLabelText('Describe the image'), {
      target: { value: 'a red fox' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByRole('img', { name: 'Attached image' })).toHaveAttribute(
      'src',
      'https://storage.test/signed/fox.png?token=t',
    );
    expect(JSON.parse(callsTo(api, 'POST /api/image/generate')[0]?.body as string)).toEqual({
      provider: 'pixels',
      model: 'pix-1',
      prompt: 'a red fox',
    });
  });
});
