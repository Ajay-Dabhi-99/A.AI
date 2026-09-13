# Comparison engine

> **Design. Implemented in Phase 4 (MODEL-014).**

Blueprint §11.

## Rules

1. Validate every selected model before starting any run (capability, guest allowance, count limit: 2 for guests, 4 for users).
2. Create one run per provider/model pair, each with its own `runId`.
3. Execute runs concurrently, each with its own timeout and `AbortController`.
4. A failed run produces an error card for that column only. Siblings keep running (`Promise.allSettled` semantics, never `Promise.all`).
5. Normalize every result to `ComparisonRun` (`packages/shared-types/src/ai.ts`).
6. Latency is measured from backend request start to the run's terminal event; time to first token is recorded separately.
7. Usage is labelled `provider` or `estimated`.
8. **No silent fallback in comparison mode.** Substituting another model would compare the wrong thing. A failed column stays failed with a retry button.

## Streaming shape

One SSE connection carries every run, multiplexed by `runId` (`ChatStreamEventMap` in `packages/shared-types/src/stream.ts`):

```
event: message.start   data: {"runId":"r1","provider":"groq","model":"llama-3.3-70b"}
event: message.start   data: {"runId":"r2","provider":"gemini","model":"gemini-2.5-flash"}
event: message.delta   data: {"runId":"r1","text":"A vector"}
event: error           data: {"runId":"r2","code":"RATE_LIMITED","message":"...","retryable":true}
event: usage           data: {"runId":"r1","usage":{"inputTokens":18,"outputTokens":52,"source":"provider"}}
event: message.done    data: {"runId":"r1","status":"completed"}
```

The landing page preview (`apps/web/src/features/landing/model-race.tsx`) already demonstrates this behavior with scripted data: one lane fails and the others finish.

## Persistence (users only)

`comparisons` (id, userId, prompt, createdAt) → `model_runs` (comparisonId, provider, model, status, latencyMs, ttftMs, inputTokens, outputTokens, usageSource, estimatedCost, errorCode).
