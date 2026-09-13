import { describe, expect, it } from 'vitest';
import { parseSseStream, type SseMessage } from '../src/index.js';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<SseMessage[]> {
  const messages: SseMessage[] = [];
  for await (const message of parseSseStream(streamOf(chunks))) messages.push(message);
  return messages;
}

describe('parseSseStream', () => {
  it('parses OpenAI-style data events and the [DONE] sentinel', async () => {
    expect(await collect(['data: {"a":1}\n\n', 'data: [DONE]\n\n'])).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'message', data: '[DONE]' },
    ]);
  });

  it('reassembles events split across arbitrary chunk boundaries', async () => {
    expect(await collect(['da', 'ta: hel', 'lo\n', '\nevent: us', 'age\ndata: 5\n\n'])).toEqual([
      { event: 'message', data: 'hello' },
      { event: 'usage', data: '5' },
    ]);
  });

  it('handles CRLF, including a CR/LF pair split between chunks', async () => {
    expect(await collect(['data: one\r', '\n\r\n', 'data: two\r\n\r\n'])).toEqual([
      { event: 'message', data: 'one' },
      { event: 'message', data: 'two' },
    ]);
  });

  it('joins multi-line data, ignores comments and keeps ids', async () => {
    expect(await collect([': keep-alive\n', 'id: 42\ndata: line 1\ndata: line 2\n\n'])).toEqual([
      { event: 'message', data: 'line 1\nline 2', id: '42' },
    ]);
  });

  it('flushes a final event that has no trailing blank line', async () => {
    expect(await collect(['data: tail'])).toEqual([{ event: 'message', data: 'tail' }]);
  });

  it('decodes multi-byte UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: नमस्ते\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 9));
        controller.enqueue(bytes.slice(9));
        controller.close();
      },
    });
    const messages: SseMessage[] = [];
    for await (const message of parseSseStream(stream)) messages.push(message);
    expect(messages).toEqual([{ event: 'message', data: 'नमस्ते' }]);
  });
});
