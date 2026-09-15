# ADR-012: Context and token management

**Status:** Accepted (2026-09-15, Phase 5)

## Context

Blueprint §10 requires a deterministic, provider-independent context builder that reserves the system prompt and the reply, includes a durable conversation summary, and never exceeds the model's budget. §16 lists Phase 5 as "token budget, trimming, summarization hooks, context cache, usage normalization", with the gate "context never exceeds selected model budget in tested scenarios".

Phase 2 shipped trimming only (ADR-009): a 4-characters-per-token estimate, a 5% safety margin, the reply capped at 4,096 tokens, oldest messages dropped. Long conversations silently forgot their beginning, and models whose tokenizers are denser than 4 characters per token were underestimated.

## Decisions

### 1. The budget is a hard invariant

```
budget = floor(contextWindow × 0.95) − maxOutputTokens
estimatedInputTokens ≤ budget        (always, or CONTEXT_TOO_LARGE)
```

`buildContext` (`apps/api/src/ai/context-builder.ts`) now takes an optional `summary` and a `charsPerToken`. The newest message is always included or the request fails with `CONTEXT_TOO_LARGE` before any allowance is used. The summary is included only when it fits together with the newest message; recent messages are then added newest to oldest while they fit. A randomized unit test builds thousands of histories, windows and summaries and asserts the invariant on every one.

The summary is folded into the single system message (`SYSTEM_PROMPT` + "Summary of the earlier conversation"), not sent as a second system message, because not every OpenAI-compatible endpoint accepts several.

### 2. Token estimates are calibrated per model from provider counts

No provider publishes a tokenizer usable in Node for every catalog model (GPT-OSS on Groq, Gemma and Nemotron on OpenRouter, Gemini). Adding several tokenizer packages would still leave gaps. Instead:

- After a completed run with provider-reported input tokens and a prompt of at least 400 characters, `TokenService` records `characters ÷ inputTokens` as an exponential moving average in Redis (`tokens:ratio:{provider}:{model}`, 30-day TTL), shared by every API instance.
- After 3 observations the model's ratio is used, clamped to **2–4** characters per token. It can only make estimates more cautious than the default, never looser.
- Provider counts include chat-template overhead, which lowers the observed ratio, which is again the cautious direction.

### 3. Summaries: same model, in the background, never blocking or charged

- **Trigger:** a chat run completed and the context builder had to leave out messages that no summary covers.
- **What is folded:** exactly the left-out messages, merged with the previous summary. The summary records the last message it covers (`summaryUpToMessageId`); later requests send only messages after it.
- **Who summarizes:** the model the user chatted with (`ModelSummarizer`, `apps/api/src/ai/summarizer.ts`), through `provider.chat` with a 600-token reply limit, a transcript sized with the cautious 2-characters-per-token ratio and capped at 60,000 characters, and a 30 s timeout. The result is capped at 2,400 characters.
- **When:** after `message.done` is sent. The stream is never held open. `ContextService.idle()` lets tests and graceful shutdown wait for pending summaries.
- **Cost:** it does not use the user's daily allowance. It does use the deployment's provider quota; `CONTEXT_SUMMARY_ENABLED=false` turns summaries off, leaving trimming only.
- **Failure:** logged (`context.summary.failed`), the previous summary is kept, and trimming keeps every request within budget.
- **Concurrency:** a Redis lock `context:{scope}:summary-lock` (60 s) allows one summary per conversation at a time. For users the database write is also a compare-and-set on the previous `summaryUpToMessageId`, so an older summary never replaces a newer one.
- **Hook:** `ConversationSummarizer` is the extension point; a cheaper dedicated model or an extractive summarizer can replace it without touching the chat service.

### 4. Where context state lives

| State                | Users                                                                     | Guests                                                    |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Summary and coverage | `conversations.summary`, `summary_up_to_message_id`, `summary_updated_at` | Redis `context:guest:{guestId}`, expires with the session |
| Summary lock         | Redis `context:{conversationId}:summary-lock`                             | Redis `context:guest:{guestId}:summary-lock`              |
| Token calibration    | Redis `tokens:ratio:{provider}:{model}`                                   | same                                                      |

"Context cache" in the blueprint is implemented as this Redis context state: the guest's temporary context, summarization coordination and the shared calibration. A read-through cache of message lists was considered and rejected: every chat turn writes the conversation, so an invalidate-on-write cache would miss on almost every request, and a write-through cache races between concurrent tabs and instances. The summary already bounds what each request needs.

A guest's summary is not carried into the account on migration (its coverage points at temporary message ids); the first long turn after signup produces a new one.

### 5. Usage is normalized once

`normalizeUsage` (`apps/api/src/ai/usage.ts`) is used by chat and comparison. Provider counts are labelled `provider` only when both input and output were reported; anything filled in from an estimate is `estimated`; `totalTokens` is always present and never below input + output.

### 6. The client sees context use

`message.start` carries `context: { inputTokens, budgetTokens, contextWindow, droppedMessages, summaryIncluded }` (estimated, before the call). The chat composer shows how much of the budget the request used and whether earlier messages were summarized or left out.

## Consequences

- Long conversations keep their key facts at the cost of one extra provider call when older messages start being left out.
- Estimates for a new model are the Phase 2 defaults until three calibrating calls have completed.
- Summary quality depends on the chat model; a weak model produces a weak summary. The hook allows replacing it.
- Summaries are not yet shown or editable in the UI; Phase 7 (history) can surface them.
