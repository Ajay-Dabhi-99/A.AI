import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider, toWireMessages } from '../src/openai-compatible.js';

describe('vision messages on the OpenAI-compatible wire format', () => {
  it('keeps text-only messages as strings', () => {
    expect(
      toWireMessages([
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hello' },
      ]),
    ).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('sends images as data-URL content parts after the text', () => {
    expect(
      toWireMessages([
        {
          role: 'user',
          content: 'What is in these?',
          images: [
            { mimeType: 'image/png', data: 'AAAA' },
            { mimeType: 'image/jpeg', data: 'BBBB' },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in these?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
        ],
      },
    ]);
  });

  it('puts the content parts in the request body', async () => {
    let body: unknown;
    const provider = new OpenAICompatibleProvider({
      id: 'test',
      label: 'Test AI',
      baseUrl: 'https://llm.example/v1',
      apiKey: 'sk-test',
      models: [],
      maxTokensParam: 'max_tokens',
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(init?.body as string);
        return new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }) as typeof fetch,
    });

    for await (const chunk of provider.stream({
      model: 'vision-1',
      messages: [
        { role: 'user', content: 'Describe', images: [{ mimeType: 'image/webp', data: 'CCCC' }] },
      ],
    })) {
      expect(chunk.type).toBe('done');
    }
    expect((body as { messages: unknown[] }).messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'image_url', image_url: { url: 'data:image/webp;base64,CCCC' } },
        ],
      },
    ]);
  });
});
