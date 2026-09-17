# Chat API

**Implemented in Phase 2.** Types: `packages/shared-types/src/chat.ts`, `stream.ts`. Schemas: `packages/validation/src/chat.ts`. Design: [ADR-009](../decisions/ADR-009-chat-providers.md).

Every request goes through the platform guards: rate limit, origin check on state-changing calls, and the [error envelope](health.md#error-envelope).

## Endpoints

| Method | Path                           | Access        | Success                          | Purpose                                                 |
| ------ | ------------------------------ | ------------- | -------------------------------- | ------------------------------------------------------- |
| GET    | `/api/models`                  | Anyone        | `200 ModelsResponse`             | Models whose provider key is configured, plus a default |
| POST   | `/api/chat`                    | Guest or user | `200 text/event-stream`          | Send a message (or retry) and stream the answer         |
| POST   | `/api/chat/suggestions`        | Guest or user | `200 ChatSuggestionsResponse`    | Up to three follow-up questions for an answer           |
| GET    | `/api/conversations`           | User          | `200 ConversationListResponse`   | Up to 50 chats: pinned first, then most recently active |
| GET    | `/api/conversations/search?q=` | User          | `200 ConversationSearchResponse` | Chats whose title or messages contain the text          |
| GET    | `/api/conversations/:id`       | User (owner)  | `200 ConversationDetail`         | One chat with every message and its run                 |
| GET    | `/api/conversations/:id/share` | User (owner)  | `200 ConversationShareResponse`  | The chat's public link, or `null`                       |
| POST   | `/api/conversations/:id/share` | User (owner)  | `200 ConversationShareResponse`  | Create the link, or refresh its snapshot                |
| DELETE | `/api/conversations/:id/share` | User (owner)  | `204`                            | Stop sharing                                            |
| GET    | `/api/shared/:token`           | Anyone        | `200 SharedConversation`         | Read a shared chat                                      |
| GET    | `/api/guest/conversation`      | Guest         | `200 GuestConversationResponse`  | The guest's temporary chat                              |
| DELETE | `/api/guest/conversation`      | Guest         | `204`                            | Start a fresh guest chat                                |
| POST   | `/api/guest/migrate`           | User          | `200 { conversationId }`         | Move the guest chat into the account (idempotent)       |

Each chat in `ConversationListResponse` and `ConversationDetail` is a `ConversationSummary`: `id`, `title`, `pinnedAt` (ISO time, or `null` when not pinned), `createdAt`, `updatedAt`. `ConversationDetail` also has `mediaJobs`, the images created in the chat ([generation](generation.md#images-inside-a-chat-model-065)). Pinned chats are listed first, most recently pinned on top; rename and pin with [`PATCH /api/conversations/:id`](history.md#patch-apiconversationsid) (MODEL-062).

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

```json
{ "provider": "groq", "model": "openai/gpt-oss-20b", "regenerate": true, "conversationId": "…" }
```

```json
{
  "provider": "groq",
  "model": "openai/gpt-oss-20b",
  "edit": true,
  "message": "Explain RAG in two sentences",
  "conversationId": "…"
}
```

| Field               | Rule                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`, `model` | Must match an entry in `GET /api/models`                                                                                                                    |
| `message`           | 1–16,000 characters after trimming; required unless `retry` or `regenerate` is set                                                                          |
| `retry`             | Answers the last unanswered user message again without repeating it                                                                                         |
| `regenerate`        | MODEL-068. Deletes the latest answer and answers the latest question again. The chat must end with an answer                                                |
| `edit`              | MODEL-068. With `message`: replaces the latest question's text, deletes everything after it, and answers again. Not for questions sent with images          |
| `conversationId`    | Users only; omit to start a new conversation. Ignored for guests.                                                                                           |
| `attachmentIds`     | Phase 8. Users only; up to 4 distinct uploaded images, with `message` only (not `retry`). The model must support vision. See [attachments](attachments.md). |

### Rejected before streaming (JSON errors)

| Status | Code                | When                                                                                           |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`  | Bad body, or retry with nothing to retry                                                       |
| 400    | `VALIDATION_ERROR`  | Regenerate with no answer to replace, edit with no question, or edit of a question with images |
| 400    | `VALIDATION_ERROR`  | Images for a model without vision, or an image that is not yours, missing or already sent      |
| 401    | `AUTH_REQUIRED`     | A guest sent `attachmentIds`                                                                   |
| 400    | `MODEL_UNAVAILABLE` | Model not offered by this instance                                                             |
| 404    | `NOT_FOUND`         | Conversation does not exist or is not yours                                                    |
| 422    | `CONTEXT_TOO_LARGE` | The newest message alone cannot fit the model                                                  |
| 429    | `QUOTA_EXCEEDED`    | Daily allowance used up (`Retry-After` until midnight UTC)                                     |
| 429    | `RATE_LIMITED`      | Too many requests                                                                              |

None of these use up allowance.

Signed-in users' [personal instructions](auth.md#personal-instructions) are added to the system prompt of every request while they are on (MODEL-069).

### Regenerate and edit (MODEL-068)

- At most one of `retry`, `regenerate` and `edit`; `attachmentIds` only with a plain new message.
- Both act on the latest question only (image requests are not questions). The chat is rewound after the request is accepted (allowance used) and before the model is called: deleted answers keep their runs in the history with no message, and a summary that covered a deleted message is dropped. Regenerate or edit counts as one message.
- Guests: the same, on the temporary chat.
- If the new answer fails, the chat ends with the question, so `retry` answers it.

### Stream

Headers: `content-type: text/event-stream`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`. A `: ping` comment is sent every 15 seconds.

```
event: message.start
data: {"runId":"…","provider":"groq","model":"openai/gpt-oss-20b","conversationId":"…or null for guests","context":{"inputTokens":1310,"budgetTokens":120622,"contextWindow":131072,"droppedMessages":0,"summaryIncluded":false}}

event: message.delta
data: {"runId":"…","text":"Retrieval-augmented"}

event: usage
data: {"runId":"…","usage":{"inputTokens":42,"outputTokens":180,"totalTokens":222,"source":"provider"}}

event: message.done
data: {"runId":"…","status":"completed","messageId":"…or null","latencyMs":2140}
```

`message.start.context` describes how the request's context was built, estimated before the call ([context management](../architecture/context-management.md)):

| Field             | Meaning                                                      |
| ----------------- | ------------------------------------------------------------ |
| `inputTokens`     | Estimated prompt tokens sent; never more than `budgetTokens` |
| `budgetTokens`    | `floor(contextWindow × 0.95)` minus the reply reservation    |
| `contextWindow`   | The model's window from the registry                         |
| `droppedMessages` | Earlier messages left out that no summary covers             |
| `summaryIncluded` | A summary of earlier messages was sent in the system message |

When messages were left out, the same model updates the conversation summary after `message.done` (not charged to the daily allowance; disabled with `CONTEXT_SUMMARY_ENABLED=false`).

### Retries and fallback (Phase 6)

When the chosen model fails **before sending any text**, the API retries it once for transient errors and then lets the next healthy model answer ([ADR-013](../decisions/ADR-013-fallback-routing.md)). The stream says so:

```
event: message.retry
data: {"runId":"…","attempt":2,"delayMs":500,"code":"PROVIDER_TIMEOUT"}

event: message.fallback
data: {"runId":"…","from":{"provider":"groq","model":"openai/gpt-oss-20b"},"to":{"provider":"gemini","model":"gemini-3.8-flash"},"code":"RATE_LIMITED","reason":"Groq returned HTTP 429"}
```

- Everything after `message.fallback` comes from `to`. The saved reply's `run` has the answering `provider`/`model` and `fallbackFrom` with the model the user chose.
- Nothing is retried or switched once text has streamed.
- At most 2 attempts on the chosen model, 1 on each of at most 2 fallback models. One message of allowance in all cases; refunded if nothing was produced.
- `CHAT_FALLBACK_ENABLED=false` keeps the retry but never switches models.

A failure after the stream opened ends with an `error` event instead of `message.done`:

```
event: error
data: {"runId":"…","code":"PROVIDER_TIMEOUT","message":"Groq stopped responding for 45s","retryable":true}
```

`usage.source` is `estimated` when the provider did not report tokens.

### Cancellation

Closing the connection (the web app's Stop button aborts the fetch) cancels the upstream provider request. The run is recorded as `CANCELLED`; partial text is kept, and if nothing had arrived the message's allowance is refunded. Full outcome table: [ADR-009](../decisions/ADR-009-chat-providers.md#4-chat-request-lifecycle).

## `POST /api/chat/suggestions`

Follow-up questions for the answer just shown (MODEL-067). The web app calls it once for each answer completed in the current session and shows the result as buttons under the latest answer; clicking one sends it as the next message.

```json
{ "question": "What is a vector database?", "answer": "A vector database stores embeddings…" }
```

```json
{
  "suggestions": [
    "How does nearest-neighbour search find similar items?",
    "What are some popular open-source vector databases?",
    "Can vector databases handle image embeddings as well?"
  ]
}
```

- `question` 1–4,000 and `answer` 1–8,000 characters after trimming (the web app sends the end of a longer answer); unknown fields are `400`.
- One non-streaming call to a text model of a healthy provider, Groq first, then the others in registry order; at most two models are tried, 12 s each. The reply is read as a JSON array (or one question per line) and cut to three distinct questions of 3–120 characters.
- Best effort: when models fail or reply with nothing usable the answer is `200 { "suggestions": [] }`. Not charged to the daily message allowance; limited to 120 an hour per user, 30 per guest session and 60 per guest IP (`429 RATE_LIMITED`).
- `CHAT_SUGGESTIONS_ENABLED=false` turns it off (always an empty list, no model call).
- Checked 2026-09-17 against Groq: three relevant questions in about 2 s.

## `GET /api/conversations/search` (MODEL-071)

Finds the signed-in user's chats whose title or any message contains `q`.

- `q`: 2–120 characters after trimming (inner spaces collapsed); otherwise `400 VALIDATION_ERROR`. Guests get `401`.
- Case-insensitive substring match; `%`, `_` and `\` are matched literally. Only the caller's chats are searched.
- At most 20 results, pinned first, then most recently active. Each is a `ConversationSummary` plus `matchedIn` (`title` when the title matches, otherwise `message`) and `snippet`: up to about 140 characters around the match in the newest matching message, on one line with `…` where it was cut, or `null` when only the title matched.
- `no-store`. There is no full-text index yet: the query is limited to one user's chats (indexed by user and by conversation); a trigram index is the upgrade path if chats grow large.

```json
{
  "results": [
    {
      "id": "…",
      "title": "Monthly budget",
      "pinnedAt": null,
      "createdAt": "…",
      "updatedAt": "…",
      "matchedIn": "message",
      "snippet": "…is it fine if my rent is 50% of my salary in Pune, or should I…"
    }
  ]
}
```

The web sidebar calls it 250 ms after typing stops (2 or more characters), shows the results with the matching text highlighted, and returns to the normal list when the box is cleared.

## Share links (MODEL-070)

A signed-in user can publish a read-only **snapshot** of a saved chat. The web app shows it at `/share/:token`.

```json
{
  "share": {
    "token": "…43 base64url characters…",
    "messageCount": 6,
    "createdAt": "2026-09-17T10:00:00.000Z",
    "updatedAt": "2026-09-17T10:00:00.000Z"
  }
}
```

- `POST` takes the chat as it is now: text of every message (at most the newest 200), and the display name of the model behind each answer. Images, generated images and personal instructions are never included. The first `POST` creates a random 32-byte token; later ones refresh the snapshot and keep the same link. A chat with no messages is `400 VALIDATION_ERROR`.
- Messages sent after the snapshot stay private until the owner updates the link. Editing, regenerating or renaming the chat does not change a snapshot either.
- `DELETE` stops sharing (the link returns `404` at once); a chat that is not shared is `404`. Deleting the chat or the account also removes the share.
- `GET /api/shared/:token` needs no account. It answers `no-store` and `x-robots-tag: noindex, nofollow`; the web page also sets `<meta name="robots" content="noindex, nofollow">`. A malformed or unknown token is `404 NOT_FOUND` ("This shared chat does not exist or was removed.").

```json
{
  "title": "Weekend trip to Jaipur",
  "messages": [
    { "role": "user", "content": "Plan a two-day trip…", "model": null },
    { "role": "assistant", "content": "**Day 1** …", "model": "GPT-OSS 120B" }
  ],
  "sharedAt": "2026-09-17T10:00:00.000Z",
  "truncated": false
}
```

- Owner routes: another user's or an unknown chat is `404`; guests are `401`.
- Storage: table `conversation_shares` (migration `20260917220000_conversation_shares`, Row Level Security enabled; the API uses its own database connection and no Data API policy exposes it).

## Guests

- A guest has one temporary chat (at most 50 messages) in Redis, expiring with the guest session.
- After signup or login the web app calls `POST /api/guest/migrate`. The chat becomes a saved conversation keyed so repeating the call cannot duplicate it, then the guest session and cookie are cleared.
