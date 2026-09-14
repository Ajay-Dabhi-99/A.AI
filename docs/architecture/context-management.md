# Context management

> **Phase 2: steps 1, 3, 4 and 5 implemented** in `apps/api/src/ai/context-builder.ts` (characters ÷ 4 estimate, 5% safety margin, reply capped at 4,096 tokens). **Phase 5:** summaries, caching and per-model tokenizers.

Blueprint §10.

## Budget

```
budget = model.contextWindow − outputReserve − systemPromptTokens − safetyMargin
```

## Algorithm (deterministic, provider-independent)

1. Reserve the system prompt.
2. Include the durable conversation summary when one exists.
3. Walk messages newest to oldest, adding each while it fits the remaining budget.
4. Return the selected messages oldest to newest.
5. If even the latest user message cannot fit, return `CONTEXT_TOO_LARGE` (422) instead of sending an oversized request.

## Token counting

- Exact counts come from provider usage after the call.
- Before the call, estimate with a tokenizer when one is available for the model family, otherwise a conservative characters-per-token ratio. Estimates are labelled `estimated`.

## Why Phase 2 needs a basic version

Phase 2 ships chat before Phase 5 ships summarization. Without at least the trimming step, a long conversation would exceed the model's window and fail at the provider. Phase 2 therefore implements steps 1, 3, 4 and 5; Phase 5 adds summaries, caching (`context:{conversationId}` in Redis) and per-model tokenizers.
