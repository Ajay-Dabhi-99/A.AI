# Phase 6: Fallback + routing

**Gate (blueprint §16):** deterministic fallback rules with tests for timeout, 429 and provider failure.

**Status: CODE COMPLETE.** Every check that can run without real infrastructure passes. DONE requires the earlier live gates, this phase's migration applied, the live fallback suite, and one real fallback between two configured providers.

Design: [ADR-013](../decisions/ADR-013-fallback-routing.md), [provider abstraction](../architecture/provider-abstraction.md#retries-fallback-and-provider-health-phase-6). API: [chat](../api/chat.md#retries-and-fallback-phase-6) (`message.retry`, `message.fallback`), [models](../api/models.md#get-apiprovidershealth) (`GET /api/providers/health`).

## Tasks

| ID        | Scope                                                                                     | Where                                                                                                   | Status                                |
| --------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| MODEL-031 | Retry and fallback decision table; abortable backoff                                      | `apps/api/src/ai/retry-policy.ts`                                                                       | CODE COMPLETE                         |
| MODEL-032 | Deterministic fallback order                                                              | `apps/api/src/ai/model-router.ts`                                                                       | CODE COMPLETE                         |
| MODEL-033 | Provider circuit breaker in Redis; `GET /api/providers/health`; comparison reports health | `apps/api/src/providers/provider-health.service.ts`, `apps/api/src/modules/models/models.routes.ts`     | CODE COMPLETE                         |
| MODEL-034 | Chat attempt loop: retry, labelled fallback, circuit skip, cancellation during backoff    | `apps/api/src/modules/chat/chat.service.ts`, `packages/shared-types/src/stream.ts`                      | CODE COMPLETE                         |
| MODEL-035 | Run records the requested model, attempts and fallback reason                             | `prisma/migrations/20260915180000_run_fallback`, `apps/api/src/repositories/conversation.repository.ts` | CODE COMPLETE (migration not applied) |
| MODEL-036 | Web: "Retrying…", fallback label, provider health badges; `CHAT_FALLBACK_ENABLED`         | `apps/web/src/features/chat/*`, `apps/web/src/pages/models-page.tsx`, `packages/config/src/server.ts`   | CODE COMPLETE                         |

## Verification

Run on 2026-09-15, Windows 11, Node 22.16.0, pnpm 10.34.5.

| Check                                         | Command                                        | Result                                                                                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck (7 workspaces), build | `pnpm verify`                                  | PASS                                                                                                                                                                                            |
| Unit                                          | `pnpm test:unit`                               | PASS, 312 tests (config 15, shared-types 9, ai-core 4, validation 28, ai-providers 31, api 167, web 58)                                                                                         |
| Integration                                   | `pnpm test:integration`                        | PASS, 55 tests (health 6, platform 9, auth 10, identity 7, chat 7, models 8, compare 4, context 2, fallback 2)                                                                                  |
| Fallback gate                                 | `apps/api/tests/unit/chat-fallback.test.ts`    | PASS, 13 tests: timeout, 429 short/long, rejected key, bad response, text streamed, unexpected error, all fail, fallback off, context too small, guest label, circuit open, Stop during backoff |
| Decision table and router                     | `retry-policy.test.ts`, `model-router.test.ts` | PASS                                                                                                                                                                                            |
| Circuit breaker                               | `provider-health.service.test.ts`              | PASS                                                                                                                                                                                            |
| Migration SQL                                 | `prisma migrate diff`                          | Generated from the Phase 5 schema (four columns on `model_runs`; no new table)                                                                                                                  |
| Live: fallback columns                        | `pnpm test:live`                               | **NOT RUN: `.env` database and Redis URLs are placeholders**                                                                                                                                    |
| Real fallback between providers               | two provider keys + `/chat`                    | **NOT RUN: no provider keys**                                                                                                                                                                   |

## Defects found and fixed during Phase 6

| Severity        | Issue                                                                                           | Fix                                                       |
| --------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P1 (build)      | `stream.ts` used `ErrorCode` for the new events without importing it (typecheck failed)         | Import added                                              |
| P3 (tests only) | Existing chat failure tests assumed no retry; with one retry the second script answered instead | Scripts fail twice where a failure is intended            |
| P3 (tests only) | A stalled check run left Vitest processes behind after a session interruption                   | Processes stopped; full `pnpm verify` re-run from scratch |

## Failure paths covered by tests

- Timeout and retryable outage: one retry on the chosen model, then fallback.
- 429 with `Retry-After` ≤ 3 s: retried after that wait; > 3 s: straight to fallback, circuit opened for the wait.
- Rejected key or unknown model, unreadable response: no retry, fallback.
- Failure after text has streamed, or an unexpected error: no retry, no fallback, error as before.
- Every candidate fails: last error reported, run recorded against the last model tried with the requested model, allowance refunded.
- Fallback disabled: retry only. Candidate that cannot fit the conversation: skipped.
- Provider down: skipped when another model can answer; tried anyway when none can, and a success closes its circuit.
- Stop during the retry wait: no further call, run `CANCELLED`, allowance refunded.
- Comparison: a failed model counts towards provider health, but nothing falls back.

## Deferred, by design

- Per-provider concurrency caps (blueprint §13): Phase 10 hardening.
- Jitter on backoff: a single retry per request makes synchronized retry storms unlikely; revisit with real traffic.
- Admin-editable fallback chains: not chosen (ADR-013); registry order already gives admins control.
