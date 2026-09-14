# Provider abstraction

Blueprint §7, [ADR-003](../decisions/ADR-003-provider-abstraction.md), [ADR-009](../decisions/ADR-009-chat-providers.md). Goal: add or replace a model without touching chat UI, quota logic or database structure.

## Layers

| Layer    | Where                                                                   | Knows about                                                                                         |
| -------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Contract | `packages/ai-core`                                                      | `AIProvider`, `AIChatRequest`, `AIResponse`, `AIStreamChunk`, `AIProviderError`, `ProviderRegistry` |
| Plumbing | `packages/ai-providers/src/http.ts`, `packages/shared-types/src/sse.ts` | Connect timeout, cancellation, status mapping, SSE parsing                                          |
| Adapter  | `packages/ai-providers/src/openai-compatible.ts`                        | The OpenAI Chat Completions streaming protocol                                                      |
| Catalog  | `packages/ai-providers/src/catalog.ts`                                  | Per-provider base URL, parameters and models                                                        |
| Wiring   | `apps/api/src/providers/model-directory.ts`                             | Which adapters exist, based on configured keys                                                      |

## `AIProvider`

```ts
interface AIProvider {
  readonly id: string;
  chat(request: AIChatRequest): Promise<AIResponse>;
  stream(request: AIChatRequest): AsyncIterable<AIStreamChunk>;
  getModels(): Promise<AIModel[]>;
}
```

`AIChatRequest.signal` cancels the upstream call. Usage carries `source: 'provider' | 'estimated'`.

## Failure policy

Every call goes through `providerFetch` and the adapter, so the policy is identical for every provider:

| Situation                             | Result                                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| Caller aborted (client left, Stop)    | Rethrows the abort. Not a provider failure.                   |
| No response headers within 20 s       | `PROVIDER_TIMEOUT`, retryable                                 |
| No stream data for 45 s               | `PROVIDER_TIMEOUT`, retryable                                 |
| Network failure or dropped connection | `MODEL_UNAVAILABLE`, retryable                                |
| HTTP or mid-stream error 429          | `RATE_LIMITED`, retryable, `Retry-After` when sent            |
| 408 / 504                             | `PROVIDER_TIMEOUT`, retryable                                 |
| 401 / 403 / 404                       | `MODEL_UNAVAILABLE`, not retryable (bad key or unknown model) |
| 5xx                                   | `MODEL_UNAVAILABLE`, retryable                                |
| Other 4xx or unreadable stream event  | `PROVIDER_BAD_RESPONSE`, not retryable                        |

Provider error bodies are discarded; they can echo keys or prompts.

## OpenAI-compatible adapter

- Sends `stream: true`, `stream_options: { include_usage: true }` and the provider's output-limit parameter.
- Yields `delta` for `choices[0].delta.content`, `usage` from `usage` or Groq's `x_groq.usage`, and `done` with the finish reason.
- Ignores SSE comments such as OpenRouter's `: OPENROUTER PROCESSING`.
- Cancels the upstream body when the consumer stops early or an error occurs.

## Adding a provider

**OpenAI-compatible** (most providers): add a key variable in `packages/config/src/server.ts` and `.env.example`, then an endpoint and model list in `catalog.ts`, and a row in the catalog test.

**Different protocol:** implement `AIProvider` in `packages/ai-providers/src/<provider>/`, use `providerFetch` for HTTP and `parseSseStream` for streams, and cover every row of the failure table with a fake `fetchImpl`.
