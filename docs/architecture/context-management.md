# Context management

> **Implemented in Phase 5.** Decisions: [ADR-012](../decisions/ADR-012-context-management.md). Phase 2 shipped trimming only (ADR-009).

Blueprint §10.

## Where it lives

| Concern                                       | Path                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Budget, summary placement, trimming (pure)    | `apps/api/src/ai/context-builder.ts`                                                                 |
| Per-model token calibration (Redis)           | `apps/api/src/ai/token.service.ts`                                                                   |
| Summarization hook and same-model summarizer  | `apps/api/src/ai/summarizer.ts`                                                                      |
| Usage normalization                           | `apps/api/src/ai/usage.ts`                                                                           |
| Planning, background summaries, guest context | `apps/api/src/services/context.service.ts`                                                           |
| Callers                                       | `apps/api/src/modules/chat/chat.service.ts`, `apps/api/src/modules/comparison/comparison.service.ts` |

## Budget

```
budget = floor(model.contextWindow × 0.95) − min(model.maxOutputTokens, 4096)
estimatedInputTokens ≤ budget, always; otherwise CONTEXT_TOO_LARGE (422) before any allowance is used
```

## Algorithm (deterministic, provider-independent)

1. Reserve the reply and the system prompt.
2. Always include the newest user message; if even that cannot fit, return `CONTEXT_TOO_LARGE`.
3. Include the durable conversation summary (inside the system message) when it fits beside the newest message.
4. Walk earlier messages newest to oldest, adding each while it fits, keeping them contiguous.
5. Drop leading assistant messages so the conversation part starts with the user.
6. Return the selected messages oldest to newest.

Messages the summary already covers are never considered: only messages after `summaryUpToMessageId` are candidates.

## Token counting

- **Before the call:** characters ÷ `charsPerToken`, plus 4 tokens per message. `charsPerToken` is 4 until a model has 3 calibrating observations, then the model's observed ratio clamped to 2–4. Calibration only makes estimates more cautious.
- **After the call:** provider counts, when reported, calibrate the model (`tokens:ratio:{provider}:{model}` in Redis) and are saved as `usageSource: provider`. Anything estimated is labelled `estimated` (`normalizeUsage`).

## Summaries

| Step    | Rule                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------- |
| Trigger | A chat answer completed and messages were left out that no summary covers                           |
| Input   | The previous summary plus exactly those messages                                                    |
| Model   | The model the user chatted with, 600-token reply, 30 s timeout, transcript ≤ 60,000 characters      |
| Output  | ≤ 2,400 characters; saved with the id of the last message it covers                                 |
| Timing  | After `message.done`; never holds the stream open                                                   |
| Cost    | Not charged to the user's allowance; `CONTEXT_SUMMARY_ENABLED=false` disables it                    |
| Failure | Logged as `context.summary` / `failed`; the old summary stays and trimming keeps requests in budget |
| Races   | Redis lock per conversation; database compare-and-set on the previous coverage                      |

Comparison prompts are single-turn, so comparison uses the calibrated estimate and usage normalization but no summaries.

## State

| Key / column                                                                    | Holds                             | Lifetime                  |
| ------------------------------------------------------------------------------- | --------------------------------- | ------------------------- |
| `conversations.summary`, `summary_up_to_message_id`, `summary_updated_at`       | A user's summary and its coverage | With the conversation     |
| `context:guest:{guestId}`                                                       | A guest's summary and coverage    | The guest session         |
| `context:{conversationId}:summary-lock`, `context:guest:{guestId}:summary-lock` | One summary at a time             | 60 s                      |
| `tokens:ratio:{provider}:{model}`                                               | Calibrated characters per token   | 30 days, refreshed on use |

## Configuration

| Variable                  | Default | Effect                                            |
| ------------------------- | ------- | ------------------------------------------------- |
| `CONTEXT_SUMMARY_ENABLED` | `true`  | `false` keeps trimming but makes no summary calls |
