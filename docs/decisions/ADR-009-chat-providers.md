# ADR-009: One OpenAI-compatible adapter, a dated model catalog, streamed chat

**Status:** Accepted (2026-09-14, Phase 2)

## Context

Phase 2 needs Groq, OpenRouter and Gemini adapters with streaming, plus a chat route that stays correct when a provider times out, rate-limits or the user presses Stop. No provider keys were available while building, so behaviour had to be proven with scripted streams.

## Decisions

### 1. One adapter for three providers

All three expose the OpenAI Chat Completions streaming protocol:

| Provider   | Base URL                                                  | Output limit parameter  |
| ---------- | --------------------------------------------------------- | ----------------------- |
| Groq       | `https://api.groq.com/openai/v1`                          | `max_completion_tokens` |
| OpenRouter | `https://openrouter.ai/api/v1`                            | `max_tokens`            |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/openai` | `max_tokens`            |

`OpenAICompatibleProvider` (`packages/ai-providers/src/openai-compatible.ts`) handles all three; the differences are configuration in `catalog.ts`. It reads usage from `usage` (OpenRouter, Gemini) or `x_groq.usage` (Groq), ignores keep-alive comments, and maps mid-stream `error` events through the same status table as HTTP errors.

Gemini's native API was not used: its compatibility endpoint supports streaming and `stream_options.include_usage`, and one code path is easier to keep correct than two.

### 2. Two timeouts

- **Connect timeout** (20 s) until response headers arrive (`providerFetch`). It no longer covers the body, which would have cut off long answers.
- **Idle timeout** (45 s) between stream chunks, inside the adapter. A stalled stream becomes `PROVIDER_TIMEOUT`.

User cancellation propagates through `AbortSignal` from the HTTP connection closing to the upstream request.

### 3. A dated, static model catalog

Checked on 2026-09-13 against provider documentation and OpenRouter's public model API:

- **Groq:** `openai/gpt-oss-120b`, `openai/gpt-oss-20b`. Groq's deprecation page lists `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` as shut down on 2026-08-16, so they are excluded even though the models page still shows them.
- **OpenRouter (free):** `google/gemma-4-31b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free` (262,144-token context from the API).
- **Gemini:** `gemini-3.8-flash`, `gemini-3.5-flash-lite`. The documentation does not publish token limits; 1,048,576 / 65,536 are assumed and **must be confirmed with a real key**.

Phase 3 replaces this with the `model_registry` table so IDs can change without a deploy.

### 4. Chat request lifecycle

`ChatService.prepare` performs every check that can reject a request (model, conversation ownership, retry validity, context budget, quota) **before** the stream opens, so those failures are ordinary JSON errors. `execute` owns the stream and always records the outcome:

| Outcome                   | Run status           | Assistant message saved | Quota    |
| ------------------------- | -------------------- | ----------------------- | -------- |
| Completed                 | `COMPLETED`          | yes                     | used     |
| Stopped with partial text | `CANCELLED`          | partial text            | used     |
| Stopped before any text   | `CANCELLED`          | no                      | refunded |
| Failed before any text    | `FAILED` / `TIMEOUT` | no                      | refunded |
| Failed after some text    | `FAILED` / `TIMEOUT` | no (partial discarded)  | used     |

Because failures save no assistant message, `retry: true` answers the last user message again without duplicating it.

### 5. Streaming transport

SSE over `POST` (browsers' `EventSource` cannot POST). The route hijacks the reply and writes events directly, carrying over headers already set (CORS, security, request id). Cookies are therefore written as real `Set-Cookie` headers instead of through `@fastify/cookie`'s send hook, which hijacked replies skip. A `: ping` comment every 15 s keeps proxies from closing idle streams.

### 6. Relative TTLs for counters

Quota counters originally used `PEXPIREAT` with an absolute timestamp from the API clock. That silently depends on the API host and Redis agreeing on the time, and it broke the test suite when the real date passed the fixed test clock. Counters now use `PEXPIRE` with a TTL computed from the service clock.

## Consequences

- Adding an OpenAI-compatible provider is a catalog entry and a key, not new code.
- Model IDs are the most perishable part of the system; `CATALOG_CHECKED_ON` records when they were verified.
- Real calls were made on 2026-09-17 with all three keys ([roadmap](../development/roadmap.md#provider-checks-2026-09-17)): Groq and OpenRouter report provider token usage; free OpenRouter models are regularly rate-limited or overloaded upstream, which retry and fallback absorb. Gemini's key stays rate-limited, so Gemini checks remain single deliberate calls.
