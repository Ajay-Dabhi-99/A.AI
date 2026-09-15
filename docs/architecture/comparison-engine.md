# Comparison engine

> **Implemented in Phase 4 (MODEL-014).** Decisions: [ADR-011](../decisions/ADR-011-comparison-engine.md). API: [comparison](../api/comparison.md).

Blueprint §11.

## Where it lives

| Concern                             | Path                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| Routes (validate, identify, stream) | `apps/api/src/modules/comparison/comparison.routes.ts`                             |
| Rules, execution, recording         | `apps/api/src/modules/comparison/comparison.service.ts`                            |
| Guest prompt for retries (Redis)    | `apps/api/src/modules/comparison/guest-comparison.store.ts`                        |
| Persistence (users)                 | `apps/api/src/repositories/comparison.repository.ts`                               |
| SSE writer shared with chat         | `apps/api/src/shared/http/event-stream.ts`                                         |
| Contracts                           | `packages/shared-types/src/comparison.ts`, `packages/validation/src/comparison.ts` |
| Web page, columns, stream state     | `apps/web/src/pages/compare-page.tsx`, `apps/web/src/features/compare/*`           |

## Rules

1. Validate every selected model before starting any run: count limit (2 for guests, 4 for users by default), availability, context fit, then allowance (one message per model, all or nothing).
2. Create one run per provider/model pair, each with its own `runId` (a `comparison_runs` row for users).
3. Execute runs concurrently, each with its own `AbortController` and a 120 s time limit.
4. A failed run produces an error card for that column only. Siblings keep running (`Promise.allSettled`, never `Promise.all`).
5. Normalize every result to the same events and the `ComparisonColumnState` shape in the web app.
6. Latency is measured from backend request start to the run's terminal event; time to first token is recorded separately.
7. Usage is labelled `provider` or `estimated`; cost is `null` when a price is unknown, never `0`.
8. **No silent fallback in comparison mode.** Substituting another model would compare the wrong thing. A failed column stays failed with a Retry button, which calls `POST /api/compare/:id/runs` for that model only.

## Request flow

```
POST /api/compare
  └─ comparisonRequestSchema          400 VALIDATION_ERROR
  └─ resolveIdentity (guest cookie issued if needed)
  └─ ComparisonService.prepare
       ├─ identity limit              400 VALIDATION_ERROR
       ├─ resolve every model         400 MODEL_UNAVAILABLE
       ├─ buildContext for each       422 CONTEXT_TOO_LARGE
       ├─ quota × N (all or nothing)  429 QUOTA_EXCEEDED
       └─ create comparison + runs (users) / prompt in Redis (guests)
  └─ openEventStream
  └─ execute: comparison.start → runs in parallel → comparison.done
```

## Run outcomes

| Outcome                    | Event                      | Stored status | Answer kept | Message refunded |
| -------------------------- | -------------------------- | ------------- | ----------- | ---------------- |
| Finished                   | `message.done` `completed` | `COMPLETED`   | yes         | no               |
| Provider error before text | `error` `failed`           | `FAILED`      | no          | yes              |
| Provider error after text  | `error` `failed`           | `FAILED`      | no          | no               |
| 120 s limit reached        | `error` `timeout`          | `TIMEOUT`     | no          | if no text       |
| Client closed / Stop       | `message.done` `cancelled` | `CANCELLED`   | partial     | if no text       |

The landing page preview (`apps/web/src/features/landing/model-race.tsx`) demonstrates the same behavior with scripted data.
