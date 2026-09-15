# Phase 7: History + analytics

**Gate (blueprint §16):** all durable runs trace back to a user and a conversation.

**Status: CODE COMPLETE.** Every check that can run without real infrastructure passes. DONE requires the earlier live gates, this phase's migration applied, and the live history suite (which includes the traceability constraints and orphan check) passing against Supabase.

Design: [ADR-014](../decisions/ADR-014-history-analytics.md). API: [history and usage](../api/history.md).

## Tasks

| ID        | Scope                                                                                           | Where                                                                                                                 | Status                                |
| --------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| MODEL-037 | History list: chats and comparisons, keyset pagination, escaped search, kind/model/date filters | `apps/api/src/repositories/history.repository.ts`, `apps/api/src/modules/history/history.service.ts`                  | CODE COMPLETE                         |
| MODEL-038 | Run detail: every chat run, saved comparison reopened                                           | `apps/api/src/modules/history/history.routes.ts`, `apps/web/src/pages/{conversation-runs,comparison-detail}-page.tsx` | CODE COMPLETE                         |
| MODEL-039 | Rename (without changing activity) and permanent delete with cascade                            | `history.repository.ts`, `apps/web/src/pages/history-page.tsx`                                                        | CODE COMPLETE                         |
| MODEL-040 | Usage analytics: personal and admin deployment totals; per model, per day, p95                  | `history.repository.ts` (`GROUPING SETS`, `percentile_cont`), `apps/web/src/pages/dashboard-page.tsx`                 | CODE COMPLETE                         |
| MODEL-041 | Usage range indexes; traceability checks                                                        | `prisma/migrations/20260915210000_usage_indexes`, `apps/api/tests/live/history.test.ts`                               | CODE COMPLETE (migration not applied) |

## Verification

Run on 2026-09-15, Windows 11, Node 22.16.0, pnpm 10.34.5.

| Check                                         | Command                                       | Result                                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck (7 workspaces), build | `pnpm verify`                                 | PASS                                                                                                                                                                  |
| Unit                                          | `pnpm test:unit`                              | PASS, 343 tests (config 15, shared-types 9, ai-core 4, validation 35, ai-providers 31, api 183, web 66)                                                               |
| Integration                                   | `pnpm test:integration`                       | PASS, 58 tests (health 6, platform 9, auth 10, identity 7, chat 7, models 8, compare 4, context 2, fallback 2, history 3)                                             |
| History service                               | `apps/api/tests/unit/history.service.test.ts` | PASS, 16 tests (order, honest cost, escaped search, filters, keyset paging, bad cursor, ownership, run detail, rename, cascade, totals, day filling, p95, deployment) |
| Web                                           | `apps/web/tests/history-page.test.tsx`        | PASS, 8 tests (list, load more, search, rename, confirmed delete, empty, guest redirect, run table, saved comparison, dashboard, admin scope)                         |
| Migration SQL                                 | `prisma migrate diff`                         | Generated from the Phase 6 schema (two `createdAt` indexes)                                                                                                           |
| Live: traceability, orphans, SQL aggregates   | `pnpm test:live`                              | **NOT RUN: `.env` database and Redis URLs are placeholders**                                                                                                          |

## Gate evidence

- Schema: `model_runs.conversationId` → `conversations.userId` → `users`, and `comparison_runs.comparisonId` → `comparisons.userId` → `users`, all `NOT NULL` with `ON DELETE CASCADE`.
- Guests never write runs to PostgreSQL; migrated guest chats are imported under the user's conversation (Phase 2).
- Every history and usage query has the user id in its `WHERE` clause (SQL), and integration tests show other users get `404` or empty lists.
- `apps/api/tests/live/history.test.ts` asserts the four constraints from `information_schema` and that no orphaned runs exist. **Not yet run against Supabase.**

## Defects found and fixed during Phase 7

| Severity        | Issue                                                                                               | Fix                                                        |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| P2 (build)      | History query schema transforms made `q` and `cursor` required in the inferred type (typecheck)     | Transform applied before `.optional()`                     |
| P3 (build)      | Chart and history page exported non-components next to components (lint, breaks fast refresh)       | Helpers made module-private                                |
| P3 (tests only) | Memory history `runFacts` returned a union of arrays (typecheck); dashboard test matched "16" twice | Return type annotated; test scoped to the tile's paragraph |

## Deferred, by design

- Searching message bodies (needs a full-text index): later, if users ask.
- `usage_events` rollups: when aggregate queries become slow (ADR-014 §4).
- A trash / undo for deletions.
- Showing conversation summaries (Phase 5) in history.
