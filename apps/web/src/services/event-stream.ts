import { parseSseStream } from '@a-ai/shared-types';
import { ApiError, apiUrl, NetworkError, toApiError } from './api';

/**
 * POSTs JSON and reads the Server-Sent Events the API returns. EventSource
 * cannot send a POST body, so this uses fetch and the shared SSE parser.
 * Rejections before the stream starts (quota, validation, model) throw
 * ApiError; events that fail validation are skipped.
 */
export async function postEventStream<Event>(
  path: string,
  body: unknown,
  options: {
    parse: (event: string, data: string) => Event | null;
    signal: AbortSignal;
    onEvent: (event: Event) => void;
  },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new NetworkError(error);
  }

  return readEventStream(response, options);
}

/** GETs Server-Sent Events with the session cookie. Same error behaviour as postEventStream. */
export async function getEventStream<Event>(
  path: string,
  options: {
    parse: (event: string, data: string) => Event | null;
    signal: AbortSignal;
    onEvent: (event: Event) => void;
  },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      credentials: 'include',
      headers: { accept: 'text/event-stream' },
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new NetworkError(error);
  }
  return readEventStream(response, options);
}

async function readEventStream<Event>(
  response: Response,
  options: {
    parse: (event: string, data: string) => Event | null;
    signal: AbortSignal;
    onEvent: (event: Event) => void;
  },
): Promise<void> {
  if (!response.ok) throw await toApiError(response);
  if (!response.body) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'The answer could not be read.',
      status: response.status,
      retryable: true,
    });
  }

  try {
    for await (const message of parseSseStream(response.body)) {
      const event = options.parse(message.event, message.data);
      if (event) options.onEvent(event);
    }
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new NetworkError(error);
  }
}
