# Provider abstraction

Blueprint §7, [ADR-003](../decisions/ADR-003-provider-abstraction.md). Goal: add or replace a model without touching chat UI, quota logic or database structure.

## Layers

| Layer               | Package                                | Knows about                                                                                         |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Contract            | `packages/ai-core`                     | `AIProvider`, `AIChatRequest`, `AIResponse`, `AIStreamChunk`, `AIProviderError`, `ProviderRegistry` |
| Plumbing            | `packages/ai-providers`                | HTTP timeouts, cancellation, status mapping, upstream SSE parsing                                   |
| Adapters (Phase 2+) | `packages/ai-providers/src/<provider>` | One provider's request/response format                                                              |
| Wiring (Phase 2+)   | `apps/api/src/providers`               | Which adapters to register, based on configured keys                                                |

## Implemented in Phase 0

### `AIProvider` (`packages/ai-core/src/provider.ts`)

```ts
interface AIProvider {
  readonly id: string;
  chat(request: AIChatRequest): Promise<AIResponse>;
  stream(request: AIChatRequest): AsyncIterable<AIStreamChunk>;
  getModels(): Promise<AIModel[]>;
}
```

`AIChatRequest.signal` is how a disconnected client or a Stop button cancels the upstream call. Usage carries `source: 'provider' | 'estimated'` so the UI can always label estimates.

### `ProviderRegistry` (`packages/ai-core/src/registry.ts`)

Adapters register only when their key is configured. `get(id)` for a missing provider throws `AIProviderError` with `MODEL_UNAVAILABLE`, `retryable: false`.

### `providerFetch` (`packages/ai-providers/src/http.ts`)

Every adapter makes HTTP calls through this one function, so the failure policy is identical everywhere:

| Situation                          | Result                                                            |
| ---------------------------------- | ----------------------------------------------------------------- |
| Caller aborted (client left, Stop) | Rethrows the abort. Not counted as a provider failure.            |
| Timeout elapsed                    | `PROVIDER_TIMEOUT`, retryable                                     |
| Network failure                    | `MODEL_UNAVAILABLE`, retryable                                    |
| HTTP 429                           | `RATE_LIMITED`, retryable, `retryAfterSeconds` from `Retry-After` |
| HTTP 408 / 504                     | `PROVIDER_TIMEOUT`, retryable                                     |
| HTTP 401 / 403 / 404               | `MODEL_UNAVAILABLE`, not retryable (bad key or unknown model)     |
| HTTP 5xx                           | `MODEL_UNAVAILABLE`, retryable                                    |
| Other 4xx                          | `PROVIDER_BAD_RESPONSE`, not retryable                            |

Error bodies from providers are drained and discarded; they can echo keys or prompts.

### `parseSseStream` (`packages/ai-providers/src/sse.ts`)

Incremental parser for OpenAI-compatible streams (OpenRouter, Groq). Handles events split across network chunks, CRLF (including a CR/LF pair split between chunks), multi-line `data`, comments/keep-alives and multi-byte UTF-8 split across chunks.

## API error mapping

`apps/api/src/shared/errors/to-api-error.ts` turns `AIProviderError` into the HTTP envelope: `RATE_LIMITED` → 429 (with `Retry-After`), `PROVIDER_TIMEOUT` → 504, `PROVIDER_BAD_RESPONSE` → 502, `MODEL_UNAVAILABLE` → 503.

## Adding an adapter (Phase 2 onward)

1. Create `packages/ai-providers/src/<provider>/` with a class implementing `AIProvider`.
2. Use `providerFetch` for every call and `parseSseStream` for streaming.
3. Map the provider's usage fields to `AIUsage` with `source: 'provider'`; fall back to estimation with `source: 'estimated'`.
4. Unit-test the request mapping, stream mapping, usage mapping and every error row above with a fake `fetchImpl`.
5. Register it in `apps/api/src/providers` only when its key is present.
