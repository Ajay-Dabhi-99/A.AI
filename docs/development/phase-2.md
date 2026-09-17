# Phase 2: Single-model chat

**Gate (blueprint §16):** complete chat loop including reconnect and failure states.

**Status: CODE COMPLETE.** Every check that can run without real infrastructure and provider keys passes. DONE requires the Phase 0 and 1 live gates, this phase's live suite, one real call per provider, and E2E.

Design: [ADR-009](../decisions/ADR-009-chat-providers.md). API: [chat](../api/chat.md), [models](../api/models.md).

## Tasks

| ID                              | Scope                                                                                         | Where                                                                                                         | Status                                |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| MODEL-009, MODEL-010, MODEL-017 | One OpenAI-compatible adapter configured for OpenRouter, Gemini and Groq; dated model catalog | `packages/ai-providers/src/openai-compatible.ts`, `catalog.ts`                                                | CODE COMPLETE (no real call yet)      |
| MODEL-011a                      | Connect vs idle timeouts; SSE parser shared with the browser                                  | `packages/ai-providers/src/http.ts`, `packages/shared-types/src/sse.ts`                                       | CODE COMPLETE                         |
| MODEL-011b                      | Model directory from configured keys; `GET /api/models`                                       | `apps/api/src/providers/model-directory.ts`                                                                   | CODE COMPLETE                         |
| MODEL-011c                      | Context budget (trim oldest, `CONTEXT_TOO_LARGE`)                                             | `apps/api/src/ai/context-builder.ts`                                                                          | CODE COMPLETE                         |
| MODEL-011d                      | `POST /api/chat` SSE: lifecycle, cancellation, quota refunds, run recording                   | `apps/api/src/modules/chat/chat.service.ts`, `chat.routes.ts`, `event-stream.ts`                              | CODE COMPLETE                         |
| MODEL-012                       | `conversations`, `messages`, `model_runs` with RLS; conversation routes                       | `prisma/migrations/20260914090000_chat_conversations`, `apps/api/src/repositories/conversation.repository.ts` | CODE COMPLETE (migration not applied) |
| MODEL-019                       | Guest chat in Redis; `/api/guest/migrate` after sign-in                                       | `apps/api/src/modules/chat/guest-conversation.store.ts`, `apps/web/src/features/auth/use-auth-actions.ts`     | CODE COMPLETE                         |
| MODEL-011e                      | Web `/chat`: streaming, safe Markdown, Stop, Retry, model picker, quota, conversation sidebar | `apps/web/src/pages/chat-page.tsx`, `src/features/chat/*`, `src/services/chat.ts`                             | CODE COMPLETE                         |

## Verification

Run on 2026-09-14, Windows 11, Node 22.16.0, pnpm 10.34.5.

| Check                                           | Command                             | Result                                                                                                           |
| ----------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck (7 workspaces), build   | `pnpm verify`                       | PASS                                                                                                             |
| Unit                                            | `pnpm test:unit`                    | PASS, 201 tests (config 15, shared-types 9, ai-core 4, validation 18, ai-providers 31, api 80, web 44)           |
| Integration                                     | `pnpm test:integration`             | PASS, 39 tests (health 5, platform 10, auth 10, identity 7, chat 7)                                              |
| Web `/chat` without infrastructure              | `pnpm dev`, open `/chat`            | PASS: header Chat link; "We couldn't check your session" with retry (API returns 500 without Redis, by design)   |
| Chat UI behaviour                               | `apps/web/tests/chat-page.test.tsx` | PASS, 11 tests (streaming, Markdown, model choice, quota, retry, stop, hostile Markdown, no models, saved chats) |
| Live: chat tables, repository, RLS, import race | `pnpm test:live`                    | **NOT RUN: needs Supabase + Upstash**                                                                            |
| Real provider call per provider                 | key + one message                   | **NOT RUN: no keys**                                                                                             |
| E2E: guest chat → sign up → chat migrated       | Playwright                          | **NOT STARTED**                                                                                                  |

## Real provider calls (2026-09-17)

With `GROQ_API_KEY` and `OPENROUTER_API_KEY` added next to `GEMINI_API_KEY`, the API enabled all three providers with no code change (`/ready` → `configured: ["openrouter", "gemini", "groq"]`). One short chat per provider passed; OpenRouter's free models needed the retry and fallback paths because of upstream rate limits and overload. Details: [roadmap, provider checks](roadmap.md#provider-checks-2026-09-17).

## Defects found and fixed during Phase 2

| Severity        | Issue                                                                                                                                    | Fix                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P1              | `providerFetch`'s timeout covered the whole response body, so long streamed answers would have been cut off                              | Timeout limited to response headers; separate 45 s idle timeout in the adapter |
| P2              | Hijacked SSE replies skip `@fastify/cookie`'s send hook, so a new guest's first chat lost its cookie                                     | Cookies written as real `Set-Cookie` headers, one per name                     |
| P2              | Quota counters used absolute `PEXPIREAT`, depending on API and Redis clocks agreeing (surfaced when the real date passed the test clock) | Relative `PEXPIRE` from the service clock                                      |
| P3 (tests only) | Adapter test fake did not error its body on abort; model store leaked between web tests                                                  | Fake errors like a real fetch body; store reset before each test               |

## Failure paths covered by tests

- Provider HTTP errors (401, 429, 5xx), mid-stream `error` events, unreadable events, idle timeout, connect timeout not cutting long streams, caller cancellation (`openai-compatible.test.ts`).
- Failure before output: run `FAILED`/`TIMEOUT`, no assistant message, allowance refunded, retry answers without duplicating the question (`chat.service.test.ts`, `chat.test.ts`, `chat-page.test.tsx`).
- Failure after partial output: partial discarded, allowance kept.
- Stop mid-answer: `CANCELLED`, partial kept; UI keeps the partial text.
- Unknown model, message too large for the model, over quota, invalid body: JSON errors before any stream, nothing saved, nothing charged.
- Another user's conversation: 404 for both reading and continuing it.
- Guest migration repeated: no duplicate conversation.
- Unsafe Markdown from a model (`javascript:` links, raw HTML): neutralised.

## Deferred, by design

- Regenerate or edit a previous message, conversation rename/delete, search: Phase 7 (history).
- Syntax highlighting in code blocks: later UI polish.
- Summaries for very long chats: Phase 5.
