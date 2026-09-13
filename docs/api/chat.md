# Chat API

> **Planned. Phase 2 (MODEL-011, MODEL-012).**

| Method | Path                     | Access        | Purpose                                   |
| ------ | ------------------------ | ------------- | ----------------------------------------- |
| POST   | `/api/chat`              | Guest or user | Send a message and stream the reply (SSE) |
| GET    | `/api/conversations`     | User          | List saved conversations                  |
| GET    | `/api/conversations/:id` | User          | Read one conversation                     |

## Streaming

`POST /api/chat` responds with `content-type: text/event-stream`. Browsers' `EventSource` only supports GET, so the web client reads the stream with `fetch` and a `ReadableStream` parser.

Events (`ChatStreamEventMap`, `packages/shared-types/src/stream.ts`): `message.start`, `message.delta`, `usage`, `message.done`, `error`.

Required server behavior:

- A comment line (`: ping`) every 15 s so proxies do not close idle streams.
- `x-accel-buffering: no` and no compression on the stream.
- Client disconnect aborts the upstream provider call through `AIChatRequest.signal`.
- Errors after the stream has started are sent as an `error` event, not an HTTP status.
