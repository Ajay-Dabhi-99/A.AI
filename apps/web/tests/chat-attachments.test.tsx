import type { AIModel } from '@a-ai/shared-types';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useModelStore } from '../src/stores/model-store';
import {
  baseRoutes,
  callsTo,
  guestMe,
  jsonResponse,
  mockApi,
  renderApp,
  userMe,
} from './helpers/render';

const textModel: AIModel = {
  id: 'openai/gpt-oss-20b',
  provider: 'groq',
  name: 'GPT-OSS 20B',
  category: 'text',
  contextWindow: 131_072,
  maxOutputTokens: 65_536,
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: true,
  availability: 'free-tier',
  inputPricePerMillionUsd: null,
  outputPricePerMillionUsd: null,
};
const visionModel: AIModel = {
  ...textModel,
  id: 'gemini-3.8-flash',
  provider: 'gemini',
  name: 'Gemini 3.8 Flash',
  supportsVision: true,
};

const attachment = {
  id: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 68,
  width: 4,
  height: 3,
  fileName: 'square.png',
  source: 'upload',
  createdAt: '2026-09-16T10:00:00.000Z',
};

beforeEach(() => {
  useModelStore.setState({ selected: null });
});

function sse(events: [string, object][]): Response {
  const body = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  return new Response(body.join(''), { headers: { 'content-type': 'text/event-stream' } });
}

function routes(defaultModel: AIModel, me = userMe, extra = {}) {
  return {
    ...baseRoutes,
    '/api/me': () => jsonResponse(me),
    'GET /api/models': () =>
      jsonResponse({
        models: [textModel, visionModel],
        providers: [
          { id: 'groq', name: 'Groq', configured: true },
          { id: 'gemini', name: 'Gemini', configured: true },
        ],
        defaultModel: { provider: defaultModel.provider, id: defaultModel.id },
      }),
    'GET /api/conversations': () => jsonResponse({ conversations: [] }),
    'GET /api/guest/conversation': () =>
      jsonResponse({ messages: [], expiresAt: '2026-09-17T10:00:00.000Z' }),
    ...extra,
  };
}

describe('attaching images in chat', () => {
  it('uploads an image and sends it with the message to a vision model', async () => {
    const api = mockApi(
      routes(visionModel, userMe, {
        'POST /api/attachments': () => jsonResponse({ attachment }, 201),
        [`GET /api/attachments/${attachment.id}/url`]: () =>
          jsonResponse({
            url: 'https://storage.test/signed/square.png?token=t',
            expiresAt: '2026-09-16T10:05:00.000Z',
          }),
        'POST /api/chat': () =>
          sse([
            [
              'message.start',
              {
                runId: 'r1',
                provider: 'gemini',
                model: 'gemini-3.8-flash',
                conversationId: null,
                context: {
                  inputTokens: 1_600,
                  budgetTokens: 900_000,
                  contextWindow: 1_048_576,
                  droppedMessages: 0,
                  summaryIncluded: false,
                },
              },
            ],
            ['message.delta', { runId: 'r1', text: 'A small red square.' }],
            ['message.done', { runId: 'r1', status: 'completed', messageId: null, latencyMs: 900 }],
          ]),
      }),
    );
    renderApp('/chat');

    const input = await screen.findByLabelText('Image files');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'square.png', {
      type: 'image/png',
    });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'What is this?' } });

    const send = screen.getByRole('button', { name: 'Send message' });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);

    expect(await screen.findByText('A small red square.')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'square.png' })).toHaveAttribute(
      'src',
      'https://storage.test/signed/square.png?token=t',
    );
    expect(callsTo(api, 'POST /api/attachments')).toHaveLength(1);
    expect(JSON.parse(callsTo(api, 'POST /api/chat')[0]?.body as string)).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      message: 'What is this?',
      attachmentIds: [attachment.id],
    });
  });

  it('does not offer images to a model that cannot read them', async () => {
    mockApi(routes(textModel));
    renderApp('/chat');
    expect(await screen.findByRole('button', { name: 'Attach images' })).toBeDisabled();
  });

  it('rejects unsupported files before uploading', async () => {
    const api = mockApi(routes(visionModel));
    renderApp('/chat');
    fireEvent.change(await screen.findByLabelText('Image files'), {
      target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] },
    });
    expect(
      await screen.findByText('Only PNG, JPEG, WebP and GIF images are supported.'),
    ).toBeInTheDocument();
    expect(callsTo(api, 'POST /api/attachments')).toHaveLength(0);
  });

  it('asks guests to sign up instead of offering uploads', async () => {
    mockApi(routes(visionModel, guestMe));
    renderApp('/chat');
    expect(await screen.findByText('Sign up to attach images')).toBeInTheDocument();
    expect(screen.queryByLabelText('Image files')).not.toBeInTheDocument();
  });
});
