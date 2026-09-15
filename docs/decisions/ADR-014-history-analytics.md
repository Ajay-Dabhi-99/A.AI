# ADR-014: History, run detail and usage analytics

**Status:** Accepted (2026-09-15, Phase 7)

## Context

Blueprint §16 Phase 7: "saved history search/filter, run detail, token/cost/latency dashboard", gated on "all durable runs trace back to user/conversation". §8 lists a `usage_events` table for "durable analytics rollups". Earlier phases deferred conversation rename/delete (Phase 2), reopening a saved comparison (Phase 4), and a usage endpoint (Phase 4).

The product owner chose on 2026-09-15: a personal dashboard for every signed-in user plus deployment-wide totals for admins (aggregated only), and history with rename and delete.

## Decisions

### 1. One history list over conversations and comparisons

`GET /api/history` returns both kinds, most recently active first.

- **Activity time:** a conversation's `updatedAt`; a comparison's latest run (its `createdAt` when it has none).
- **Pagination:** keyset on `(lastActivityAt desc, id desc)` with an opaque cursor, at most 50 per page. Offsets would skip or repeat items while the user is chatting in another tab.
- **Search:** case-insensitive substring on the conversation title or comparison prompt, with `%`, `_` and `\` escaped. Message bodies are not searched: without a full-text index that is a sequential scan over every message. Full-text search can follow if users need it.
- **Filters:** kind, a model (any run in the item used it), and a date range on activity time (UTC days).
- **Scope:** the signed-in user only, enforced in the query itself. Guests have no history (ADR-002).

### 2. Run detail

- `GET /api/conversations/:id/runs`: every run of a conversation in order, including failed and cancelled runs that saved no message, with status, answering and requested model (Phase 6), attempts, fallback reason, time to first token, latency, tokens with their source, estimated cost and error code.
- `GET /api/comparisons/:id`: the prompt and every run with its answer and the same metrics. This is how a saved comparison is reopened.
- Another user's id, or a malformed one, is `404 NOT_FOUND`.

### 3. Rename and delete

- `PATCH /api/conversations/:id` with `{ title }` (1–120 characters after trimming). Renaming is not activity: `updatedAt` is not changed, so the list order stays put.
- `DELETE /api/conversations/:id` and `DELETE /api/comparisons/:id` are permanent. Messages and runs go with them through the existing `ON DELETE CASCADE` foreign keys, so deleted runs also leave the dashboard. The web app asks for confirmation first.
- Deletions are logged as `history.deleted` with the user id, kind and item id, never titles or content.

### 4. Analytics come from the run tables; no `usage_events` yet

`model_runs` and `comparison_runs` already hold every durable provider call with status, tokens, usage source, latency and estimated cost. A second copy in `usage_events` would have to be kept consistent through retries, fallbacks and deletions, for no gain at the current volume. Queries aggregate the run tables directly; rollups can be added when a query plan says so.

- **Ranges:** the last N UTC days including today, 1–90 (default 30). Every day in the range is returned, including days with no runs, so charts never hide gaps.
- **Personal** (`GET /api/usage`): runs of the user's conversations and comparisons.
- **Deployment** (`GET /api/admin/usage`, admins only): all runs, plus the number of distinct active users. Aggregates only; no prompts, titles, answers or per-user rows.
- **Metrics:**
  - runs, split into completed, failed (`FAILED` + `TIMEOUT`) and cancelled
  - input and output tokens, with how many runs had provider-reported counts
  - estimated cost: the sum of known estimates, plus how many runs had one
  - average and p95 latency over completed runs
  - runs answered by a fallback model
- **Honesty rules:** totals built from estimates say so in the UI; an unknown cost is never counted as zero; a p95 needs at least 20 completed runs and is otherwise `null`.

### 5. Traceability (the Phase 7 gate)

Every durable run is attached to a user by the schema, not by convention:

- `model_runs.conversationId` is `NOT NULL` with a foreign key to `conversations`, whose `userId` is `NOT NULL` with a foreign key to `users`; both cascade on delete.
- `comparison_runs.comparisonId` → `comparisons.userId` → `users`, the same way.
- Guests never write runs to PostgreSQL (Redis only); migrated guest chats are imported under the user's conversation.
- Every history and usage query joins through these keys with the user id in the `WHERE` clause.
- A live test checks the `NOT NULL` and foreign-key constraints in `information_schema` and that no orphaned runs exist.

### 6. Indexes

`model_runs(createdAt)` and `comparison_runs(createdAt)` support deployment-wide range scans. Personal queries go through the existing `conversations(userId, updatedAt)` and `comparisons(userId, createdAt)` indexes.

### 7. Web

- `/history`: search, kind, model and period filters, "Load more", rename and delete with confirmation.
- `/history/chats/:id`: the run table.
- `/history/comparisons/:id`: the saved comparison, read-only columns.
- `/dashboard`: stat tiles, runs per day and a per-model table; admins can switch to the deployment view.
- Charts are small SVG components with no new dependency, following the project's data-visualization guidance: honest zero baseline, labelled estimates, accessible text alternatives.

## Consequences

- History search misses words that appear only inside messages.
- Dashboards cost one aggregate query per view; heavy use or large tables will need rollups (`usage_events`) later.
- Deleting is irreversible; there is no trash.
