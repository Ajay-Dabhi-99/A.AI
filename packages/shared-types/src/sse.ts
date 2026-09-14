/**
 * Incremental Server-Sent Events parser. Shared by the provider adapters
 * (reading OpenAI-compatible upstream streams) and the web app (reading the
 * A.ai chat stream), so both sides handle the protocol identically.
 * Follows the WHATWG event-stream rules that matter here: CRLF/LF/CR line
 * endings, multi-line data, comments, and events split across network chunks.
 * Uses only web-standard APIs (ReadableStream, TextDecoder), so it runs in
 * Node and in browsers.
 */

export type SseMessage = {
  event: string;
  data: string;
  id?: string;
};

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage, void, undefined> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  let event = '';
  let id: string | undefined;
  let dataLines: string[] = [];

  function* dispatch(): Generator<SseMessage> {
    if (dataLines.length > 0) {
      yield {
        event: event || 'message',
        data: dataLines.join('\n'),
        ...(id === undefined ? {} : { id }),
      };
    }
    event = '';
    dataLines = [];
  }

  function* processLine(line: string): Generator<SseMessage> {
    if (line === '') {
      yield* dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let match: RegExpExecArray | null;
      const lineBreak = /\r\n|\r|\n/g;
      let consumed = 0;
      while ((match = lineBreak.exec(buffer)) !== null) {
        // A trailing lone CR may be the first half of CRLF split across chunks.
        if (match[0] === '\r' && match.index === buffer.length - 1 && !done) break;
        yield* processLine(buffer.slice(consumed, match.index));
        consumed = match.index + match[0].length;
      }
      buffer = buffer.slice(consumed);

      if (done) {
        if (buffer !== '') yield* processLine(buffer);
        yield* dispatch();
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
