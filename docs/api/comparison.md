# Comparison API

**Implemented in Phase 4 (MODEL-014).** Types: `packages/shared-types/src/comparison.ts`. Schemas: `packages/validation/src/comparison.ts`. Design: [ADR-011](../decisions/ADR-011-comparison-engine.md), [comparison engine](../architecture/comparison-engine.md).

Every request goes through the platform guards: rate limit, origin check, and the [error envelope](health.md#error-envelope).

## Endpoints

| Method | Path                              | Access                        | Success                 | Purpose                                        |
| ------ | --------------------------------- | ----------------------------- | ----------------------- | ---------------------------------------------- |
| POST   | `/api/compare`                    | Guest or user                 | `200 text/event-stream` | Run one prompt on 2–4 models at once           |
| POST   | `/api/compare/:comparisonId/runs` | The guest or user who owns it | `200 text/event-stream` | Run the comparison's prompt on one model again |

The caller's model limit and remaining daily allowance come from [`GET /api/me`](auth.md) (`limits.compareMaxModels`, `quota`). A separate usage endpoint is not needed until Phase 7 analytics.

## `POST /api/compare`

```json
{
  "prompt": "Explain vector databases to a product manager",
  "models": [
    { "provider": "groq", "model": "openai/gpt-oss-20b" },
    { "provider": "gemini", "model": "gemini-2.5-flash" }
  ]
}
```

| Field    | Rule                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prompt` | 1–16,000 characters after trimming                                                                                                                                       |
| `models` | 2–4 distinct `{ provider, model }` from `GET /api/models`; at most `GUEST_COMPARE_MAX_MODELS` (default 2) for guests and `USER_COMPARE_MAX_MODELS` (default 4) for users |

Each model uses one message of the daily allowance. A run that produces no text gives its message back.

### Rejected before streaming (JSON errors)

Nothing runs and no allowance is used.

| Status | Code                | When                                                                     |
| ------ | ------------------- | ------------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR`  | Bad body, fewer than 2 or duplicate models, or over the identity's limit |
| 400    | `MODEL_UNAVAILABLE` | A model is not offered; `details[0].path` is `models.N`                  |
| 422    | `CONTEXT_TOO_LARGE` | The prompt does not fit one of the models; the message names it          |
| 429    | `QUOTA_EXCEEDED`    | Not enough allowance for every model (`Retry-After` until midnight UTC)  |
| 429    | `RATE_LIMITED`      | Too many requests                                                        |

### Stream

Headers as for [chat](chat.md#stream). Events are multiplexed by `runId`:

```
event: comparison.start
data: {"comparisonId":"…","runs":[{"runId":"r1","provider":"groq","model":"openai/gpt-oss-20b"},{"runId":"r2","provider":"gemini","model":"gemini-2.5-flash"}]}

event: message.delta
data: {"runId":"r1","text":"A vector database"}

event: error
data: {"runId":"r2","status":"failed","latencyMs":412,"code":"RATE_LIMITED","message":"Gemini is rate limiting requests","retryable":true}

event: usage
data: {"runId":"r1","usage":{"inputTokens":42,"outputTokens":180,"totalTokens":222,"source":"provider"}}

event: message.done
data: {"runId":"r1","status":"completed","latencyMs":2140,"ttftMs":310,"estimatedCost":0.000021}

event: comparison.done
data: {"comparisonId":"…"}
```

- Every run ends with exactly one `message.done` (`completed` or `cancelled`) or `error` (`failed` or `timeout`). `comparison.done` is always last.
- One run failing never stops the others. There is no fallback to a different model.
- `latencyMs` is measured from the start of the request; `ttftMs` is the time to the first text, `null` if none arrived.
- `usage.source` is `estimated` when the provider reported no token counts. `estimatedCost` is `null` when a price is unknown.
- A run still going after 120 seconds ends with `error` `status: "timeout"`, code `PROVIDER_TIMEOUT`.

### Cancellation

Closing the connection cancels every run. Runs are recorded as `CANCELLED`; partial answers are kept, and runs that produced nothing give their message back.

## `POST /api/compare/:comparisonId/runs`

```json
{ "provider": "gemini", "model": "gemini-2.5-flash" }
```

Runs the stored prompt on one available model and streams the same events with one run. It uses one message. The earlier run keeps its outcome; a new run is added.

| Status | Code        | When                                                                                 |
| ------ | ----------- | ------------------------------------------------------------------------------------ |
| 404    | `NOT_FOUND` | Malformed id, unknown comparison, someone else's, or a guest comparison that expired |

Plus the model, context, quota and rate-limit errors above.

## Storage

- Users: `comparisons` (prompt) and `comparison_runs` (status, answer, `ttftMs`, `latencyMs`, tokens, `usageSource`, `estimatedCostUsd`, `errorCode`, `position`). RLS enabled.
- Guests: `guest:comparison:{id}` in Redis holds only the prompt, for retries, until the guest session expires.
