# Context management

> **Design. Basic budget in Phase 2, full implementation in Phase 5.**

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
