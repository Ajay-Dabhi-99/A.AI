# Phase 4: Comparison engine

**Gate (blueprint §16):** one failed model must not break sibling results.

**Status: CODE COMPLETE.** Every check that can run without real infrastructure passes. DONE requires the earlier live gates, this phase's migration applied, the live comparison suite, a real comparison with at least two provider keys, and E2E.

Design: [ADR-011](../decisions/ADR-011-comparison-engine.md), [comparison engine](../architecture/comparison-engine.md). API: [comparison](../api/comparison.md), [auth](../api/auth.md) (`limits`).

## Tasks

| ID         | Scope                                                                                            | Where                                                                                                        | Status                                |
| ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| MODEL-014a | Contracts: request schemas, multiplexed stream events, `MeResponse.limits`                       | `packages/shared-types/src/comparison.ts`, `packages/validation/src/comparison.ts`                           | CODE COMPLETE                         |
| MODEL-014b | `comparisons` and `comparison_runs` with RLS; repository                                         | `prisma/migrations/20260915090000_comparisons`, `apps/api/src/repositories/comparison.repository.ts`         | CODE COMPLETE (migration not applied) |
| MODEL-014c | Service: validate all first, quota per model, concurrent runs, per-run timeout, no fallback      | `apps/api/src/modules/comparison/comparison.service.ts`, `apps/api/src/ai/run-error.ts`                      | CODE COMPLETE                         |
| MODEL-014d | Routes: `POST /api/compare`, `POST /api/compare/:id/runs`; guest prompt store; shared SSE writer | `apps/api/src/modules/comparison/*.ts`, `apps/api/src/shared/http/event-stream.ts`                           | CODE COMPLETE                         |
| MODEL-024  | Configurable limits `GUEST_COMPARE_MAX_MODELS` / `USER_COMPARE_MAX_MODELS`                       | `packages/config/src/server.ts`, `.env.example`, `apps/api/src/modules/users/me.routes.ts`                   | CODE COMPLETE                         |
| MODEL-025  | Web `/compare`: model picker, independent columns, metrics, per-column retry, stop               | `apps/web/src/pages/compare-page.tsx`, `apps/web/src/features/compare/*`, `apps/web/src/services/compare.ts` | CODE COMPLETE                         |

## Verification

Run on 2026-09-15, Windows 11, Node 22.16.0, pnpm 10.34.5.

| Check                                         | Command                                          | Result                                                                                                       |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Format, lint, typecheck (7 workspaces), build | `pnpm verify`                                    | PASS                                                                                                         |
| Unit                                          | `pnpm test:unit`                                 | PASS, 250 tests (config 15, shared-types 9, ai-core 4, validation 28, ai-providers 31, api 107, web 56)      |
| Integration                                   | `pnpm test:integration`                          | PASS, 51 tests (health 6, platform 9, auth 10, identity 7, chat 7, models 8, compare 4)                      |
| Comparison service                            | `apps/api/tests/unit/comparison.service.test.ts` | PASS, 11 tests (concurrency, partial failure, leak-free errors, timeout, cancel, validation, quota, retries) |
| Compare UI behaviour                          | `apps/web/tests/compare-page.test.tsx`           | PASS, 6 tests (failed column isolated, retry one column, rejection, stop, user limit, too few models)        |
| Migration SQL                                 | `prisma migrate diff`                            | Generated from the Phase 3 schema; RLS statements appended                                                   |
| Live: comparison tables, RLS, repository      | `pnpm test:live`                                 | **NOT RUN: `.env` database and Redis URLs are placeholders**                                                 |
| Real comparison with two providers            | keys + `/compare`                                | **NOT RUN: no provider keys**                                                                                |
| E2E: guest compares, one provider fails       | Playwright                                       | **NOT STARTED**                                                                                              |
| Web without API                               | `pnpm dev:web`, open `/`                         | PASS: pages and new logo/favicon render; API stays down with placeholder `.env` (does not listen on 4000)    |

## Defects found and fixed during Phase 4

| Severity        | Issue                                                                                         | Fix                                                       |
| --------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P2              | Duplicate-model check keyed on a raw control character in source                              | Key is `JSON.stringify([provider, model])`                |
| P3              | Web `streamChat` lost its SSE helper import during the shared-helper refactor (typecheck)     | Imports `postEventStream` from `services/event-stream.ts` |
| P3              | `model-picker.tsx` exported a helper beside a component (breaks fast refresh, lint)           | `modelRefKey` moved to `use-comparison.ts`                |
| P3 (tests only) | Retry test expected `FAILED` for a provider `PROVIDER_TIMEOUT`; the service records `TIMEOUT` | Expectation corrected                                     |

## Failure paths covered by tests

- One model errors before output: `error` for that run only, sibling completes, its message refunded, run `FAILED`.
- One model errors after output: partial discarded, allowance kept; unexpected errors become `INTERNAL_ERROR` without leaking the message.
- One model hangs: `error` `timeout` / `PROVIDER_TIMEOUT` after the run limit, siblings unaffected, refunded.
- Client disconnect or Stop: every run `CANCELLED`, partial text kept, empty runs refunded; UI marks columns Stopped.
- Rejected up front, nothing started or charged: over the identity limit, one model, duplicates, unavailable model (names `models.N`), prompt too large for one model, not enough allowance for all models.
- Retry: owner only (user row or guest session); another user, another guest, malformed id → 404.

## Deferred, by design

- Comparison history and reopening a saved comparison: Phase 7.
- Per-provider concurrency caps (blueprint §13): Phase 6 routing; run count is capped at 4 per request meanwhile.
- Retry for non-retryable errors (for example `PROVIDER_BAD_RESPONSE`): the column shows the error without a Retry button.
