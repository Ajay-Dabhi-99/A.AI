# Chat API

**Implemented in Phase 2.** Types: `packages/shared-types/src/chat.ts`, `stream.ts`. Schemas: `packages/validation/src/chat.ts`. Design: [ADR-009](../decisions/ADR-009-chat-providers.md).

Every request goes through the platform guards: rate limit, origin check on state-changing calls, and the [error envelope](health.md#error-envelope).

## Endpoints

| Method | Path                      | Access        | Success                         | Purpose                                                 |
| ------ | ------------------------- | ------------- | ------------------------------- | ------------------------------------------------------- |
| GET    | `/api/models`             | Anyone        | `200 ModelsResponse`            | Models whose provider key is configured, plus a default |
| POST   | `/api/chat`               | Guest or user | `200 text/event-stream`         | Send a message (or retry) and stream the answer         |
| GET    | `/api/conversations`      | User          | `200 ConversationListResponse`  | Up to 50 chats, most recently active first              |
| GET    | `/api/conversations/:id`  | User (owner)  | `200 ConversationDetail`        | One chat with every message and its run                 |
| GET    | `/api/guest/conversation` | Guest         | `200 GuestConversationResponse` | The guest's temporary chat                              |
| DELETE | `/api/guest/conversation` | Guest         | `204`                           | Start a fresh guest chat                                |
| POST   | `/api/guest/migrate`      | User          | `200 { conversationId }`        | Move the guest chat into the account (idempotent)       |

## `POST /api/chat`

```json
{
  "provider": "groq",
  "model": "openai/gpt-oss-20b",
  "message": "Explain RAG",
  "conversationId": "…optional…"
}
```

```json
{ "provider": "groq", "model": "openai/gpt-oss-20b", "retry": true, "conversationId": "…" }
```

| Field               | Rule                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `provider`, `model` | Must match an entry in `GET /api/models`                                |
| `message`           | 1–16,000 characters after trimming; exactly one of `message` or `retry` |
| `retry`             | Answers the last unanswered user message again without repeating it     |
| `conversationId`    | Users only; omit to start a new conversation. Ignored for guests.       |

### Rejected before streaming (JSON errors)

| Status | Code                | When                                                       |
| ------ | ------------------- | ---------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`  | Bad body, or retry with nothing to retry                   |
| 400    | `MODEL_UNAVAILABLE` | Model not offered by this instance                         |
| 404    | `NOT_FOUND`         | Conversation does not exist or is not yours                |
| 422    | `CONTEXT_TOO_LARGE` | The newest message alone cannot fit the model              |
| 429    | `QUOTA_EXCEEDED`    | Daily allowance used up (`Retry-After` until midnight UTC) |
| 429    | `RATE_LIMITED`      | Too many requests                                          |

None of these use up allowance.

### Stream

Headers: `content-type: text/event-stream`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`. A `: ping` comment is sent every 15 seconds.

```
event: message.start
data: {"runId":"…","provider":"groq","model":"openai/gpt-oss-20b","conversationId":"…or null for guests"}

event: message.delta
data: {"runId":"…","text":"Retrieval-augmented"}

event: usage
data: {"runId":"…","usage":{"inputTokens":42,"outputTokens":180,"totalTokens":222,"source":"provider"}}

event: message.done
data: {"runId":"…","status":"completed","messageId":"…or null","latencyMs":2140}
```

A failure after the stream opened ends with an `error` event instead of `message.done`:

```
event: error
data: {"runId":"…","code":"PROVIDER_TIMEOUT","message":"Groq stopped responding for 45s","retryable":true}
```

`usage.source` is `estimated` when the provider did not report tokens.

### Cancellation

Closing the connection (the web app's Stop button aborts the fetch) cancels the upstream provider request. The run is recorded as `CANCELLED`; partial text is kept, and if nothing had arrived the message's allowance is refunded. Full outcome table: [ADR-009](../decisions/ADR-009-chat-providers.md#4-chat-request-lifecycle).

## Guests

- A guest has one temporary chat (at most 50 messages) in Redis, expiring with the guest session.
- After signup or login the web app calls `POST /api/guest/migrate`. The chat becomes a saved conversation keyed so repeating the call cannot duplicate it, then the guest session and cookie are cleared.
