# ADR-011: Comparison engine

**Status:** Accepted (2026-09-15, Phase 4)

## Context

Blueprint §11 asks for one prompt sent to several models in parallel, normalized results, latency, tokens and errors per model, and a gate that one failed model must not break its siblings. The blueprint leaves open how results reach the browser, how comparisons count against the daily allowance, where runs are stored, and how a failed column is retried.

## Decisions

### 1. One SSE connection, multiplexed by `runId`

`POST /api/compare` answers with one `text/event-stream` carrying every run:

| Event              | When                                                                             |
| ------------------ | -------------------------------------------------------------------------------- |
| `comparison.start` | First. `comparisonId` and every `runId` in request order                         |
| `message.delta`    | Text from one run                                                                |
| `usage`            | Before a run's `message.done`; `source` is `provider` or `estimated`             |
| `message.done`     | Run ended: `completed` or `cancelled`, with `latencyMs`, `ttftMs`, cost estimate |
| `error`            | Run failed (`failed`) or hit its time limit (`timeout`)                          |
| `comparison.done`  | Last, after every run has sent exactly one `message.done` or `error`             |

One connection instead of one per model: it's one request to rate-limit, one Stop, one place to cancel all upstream calls, and fewer browser connection slots. Types: `packages/shared-types/src/comparison.ts`. Schemas and parser: `packages/validation/src/comparison.ts`.

### 2. Everything that can reject is checked before any run starts

`ComparisonService.prepare` checks in this order, and each failure is a JSON error with no stream:

1. Request shape: 2–4 distinct models, prompt 1–16,000 characters (`VALIDATION_ERROR`).
2. The identity's model limit (`VALIDATION_ERROR`).
3. Every model is available (`MODEL_UNAVAILABLE`, naming the model and `models.N`).
4. The prompt fits every model's context budget (`CONTEXT_TOO_LARGE`, naming the model).
5. Allowance for every model (`QUOTA_EXCEEDED`).

A comparison never starts some columns and rejects others.

### 3. One message of allowance per model, all or nothing

A four-model comparison is four provider calls, so it uses four messages. The service takes them one at a time and gives back what it took if the allowance runs out partway, so a rejected comparison uses nothing. As in chat, a run that produced no text (failure, timeout, cancelled before the first token) gives its message back. A run that failed after producing text keeps it.

### 4. Isolation: `Promise.allSettled`, a controller and a time limit per run

- Each run gets its own `AbortController`. The request's abort (client disconnect or Stop) is forwarded to every run; a run's timeout aborts only that run.
- `COMPARISON_RUN_TIMEOUT_MS` (120 s) caps a whole run, on top of the adapters' connect and 45 s idle timeouts (ADR-009). A timed-out run is `TIMEOUT` / `PROVIDER_TIMEOUT`.
- Runs are awaited with `Promise.allSettled`, never `Promise.all`. Unexpected errors become `INTERNAL_ERROR` with a generic message (`apps/api/src/ai/run-error.ts`, shared with chat).
- **No fallback in comparison mode.** Substituting another model would compare the wrong thing. A failed column stays failed until the user retries it.

### 5. Limits are configuration

`GUEST_COMPARE_MAX_MODELS` (default 2) and `USER_COMPARE_MAX_MODELS` (default 4), each 2–4. The web app reads the caller's limit from `GET /api/me` (`limits.compareMaxModels`) rather than hard-coding it. The API still enforces it.

### 6. Storage: `comparisons` and `comparison_runs`, users only

- Not `model_runs`: its `conversation_id` is required and a run may own a chat message. Making it nullable would weaken chat's invariants to fit a different shape. Phase 7 analytics can read both tables.
- `comparison_runs.position` records the order runs were started: request order, then retries. `created_at` cannot, because runs created in one transaction share a timestamp.
- A run stores its answer in `content`. A failed run's partial output is discarded, as in chat. A cancelled run keeps what arrived.
- RLS is enabled on both tables (ADR-005).
- Guests: only `{ id, guestId, prompt }` is kept, in Redis at `guest:comparison:{id}`, expiring with the guest session. That is enough to retry a column; answers are not stored because guests have no history.

### 7. Retry adds a run

`POST /api/compare/:comparisonId/runs` with `{ provider, model }` streams the same event shape with one run. It reuses the stored prompt, uses one message, and adds a run; the failed run keeps its recorded outcome. Only the owner can retry: the user who owns the row, or the guest whose session created it. Anyone else gets `404 NOT_FOUND`, never `403`, so ids cannot be probed.

### 8. Latency

`latencyMs` runs from the start of the backend request (before validation and quota) to the run's terminal event, per blueprint §11. `ttftMs` is recorded separately. Both are measured on the API host.

## Consequences

- Comparisons use allowance faster than chat; the page states "each model uses one".
- There is no comparison history screen yet. Saved runs are for Phase 7 (history and analytics).
- Per-provider concurrency caps (blueprint §13) are not implemented; the run count per request is capped at 4, and the daily allowance bounds the total. Revisit with Phase 6 routing.
