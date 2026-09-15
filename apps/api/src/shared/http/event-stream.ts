import type { FastifyReply } from 'fastify';

/** Comment lines keep proxies and load balancers from closing an idle stream. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Any named SSE event; chat and comparison each narrow it to their own event union. */
export type StreamEvent = { event: string; data: unknown };

export type EventStream<Event extends StreamEvent> = {
  send(event: Event): void;
  close(): void;
};

/**
 * Switches the reply to Server-Sent Events. Headers already set on the reply
 * (CORS, security headers, request id, cookies) are carried over, because a
 * hijacked reply skips Fastify's normal send pipeline.
 */
export function openEventStream<Event extends StreamEvent>(
  reply: FastifyReply,
): EventStream<Event> {
  const inherited = Object.fromEntries(
    Object.entries(reply.getHeaders()).filter(
      (entry): entry is [string, string | number | string[]] => entry[1] !== undefined,
    ),
  );
  reply.hijack();
  const raw = reply.raw;

  raw.writeHead(200, {
    ...inherited,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Disables response buffering in nginx-style proxies.
    'x-accel-buffering': 'no',
  });
  raw.flushHeaders();

  const writable = () => !raw.writableEnded && !raw.destroyed;
  const heartbeat = setInterval(() => {
    if (writable()) raw.write(': ping\n\n');
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    send(event) {
      if (writable()) raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      if (writable()) raw.end();
    },
  };
}
