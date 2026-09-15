# Phase 5: Context + token management

**Gate (blueprint §16):** context never exceeds the selected model's budget in tested scenarios.

**Status: CODE COMPLETE.** Every check that can run without real infrastructure passes, including a 5,000-case randomized budget test. DONE requires the earlier live gates, this phase's migration applied, the live summary suite, and one long conversation summarized with a real provider key.

Design: [ADR-012](../decisions/ADR-012-context-management.md), [context management](../architecture/context-management.md). API: [chat](../api/chat.md) (`message.start.context`).

## Tasks

| ID        | Scope                                                                                         | Where                                                                                                                                  | Status                                |
| --------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| MODEL-026 | Budget invariant; summary inside the system message; per-model ratio in the builder           | `apps/api/src/ai/context-builder.ts`                                                                                                   | CODE COMPLETE                         |
| MODEL-027 | Token estimates calibrated from provider counts, shared in Redis                              | `apps/api/src/ai/token.service.ts`, `apps/api/src/services/kv-store.ts` (`setJsonIfAbsent`)                                            | CODE COMPLETE                         |
| MODEL-028 | Summarization hook, same-model summarizer, background summaries with lock and compare-and-set | `apps/api/src/ai/summarizer.ts`, `apps/api/src/services/context.service.ts`, `prisma/migrations/20260915140000_conversation_summaries` | CODE COMPLETE (migration not applied) |
| MODEL-029 | Usage normalization for chat and comparison                                                   | `apps/api/src/ai/usage.ts`, `apps/api/src/modules/chat/chat.service.ts`, `apps/api/src/modules/comparison/comparison.service.ts`       | CODE COMPLETE                         |
| MODEL-030 | `message.start.context`, `CONTEXT_SUMMARY_ENABLED`, context use in the chat footer            | `packages/shared-types/src/stream.ts`, `packages/config/src/server.ts`, `apps/web/src/features/chat/chat-panel.tsx`                    | CODE COMPLETE                         |

## Verification

Run on 2026-09-15, Windows 11, Node 22.16.0, pnpm 10.34.5.

| Check                                           | Command                                       | Result                                                                                                      |
| ----------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck (7 workspaces), build   | `pnpm verify`                                 | PASS                                                                                                        |
| Unit                                            | `pnpm test:unit`                              | PASS, 280 tests (config 15, shared-types 9, ai-core 4, validation 28, ai-providers 31, api 137, web 56)     |
| Integration                                     | `pnpm test:integration`                       | PASS, 53 tests (health 6, platform 9, auth 10, identity 7, chat 7, models 8, compare 4, context 2)          |
| Budget gate                                     | `apps/api/tests/unit/context-budget.test.ts`  | PASS: 5,000 generated conversations (windows, reply sizes, ratios 2–4, summaries); none exceeded its budget |
| Summaries and calibration                       | `apps/api/tests/unit/context.service.test.ts` | PASS, 9 tests                                                                                               |
| Migration SQL                                   | `prisma migrate diff`                         | Generated from the Phase 4 schema (three nullable columns; no new table)                                    |
| Live: summary compare-and-set, `updatedAt` kept | `pnpm test:live`                              | **NOT RUN: `.env` database and Redis URLs are placeholders**                                                |
| Real long conversation summarized               | provider key + `/chat`                        | **NOT RUN: no provider keys**                                                                               |

## Defects found and fixed during Phase 5

| Severity        | Issue                                                                                                    | Fix                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P2              | Prisma `@updatedAt` would have moved a conversation to the top of the list when only its summary changed | Summary written with a raw compare-and-set `UPDATE` that leaves `updatedAt` alone |
| P3              | A cancelled chat's `message.done` would have carried the internal usage object after the record refactor | Fields listed explicitly                                                          |
| P3 (tests only) | "Too small to summarize" test used a model large enough to summarize                                     | Test model window reduced to 600 tokens                                           |

## Failure paths covered by tests

- Newest message cannot fit: `CONTEXT_TOO_LARGE` before quota, for any ratio (randomized).
- Summary too large to fit beside the newest message: left out; request still within budget.
- Summarizer fails, returns nothing, or the model is too small: logged, previous summary kept, later turns still within budget.
- Two summaries at once: the second does not start (lock); an older summary cannot overwrite a newer one (compare-and-set).
- Summaries disabled: trimming only, no summary calls.
- Guest "New chat" and guest migration: guest summary removed.
- Provider reports partial or invalid usage: labelled `estimated`, totals never below input + output.
- Corrupt calibration data in Redis: ignored, default ratio used.

## Deferred, by design

- Showing or editing summaries in the UI: Phase 7 (history).
- Loading only messages after the summary coverage from the database: with Phase 7 pagination.
- Real tokenizers per model family: only if calibrated estimates prove too cautious in practice.
