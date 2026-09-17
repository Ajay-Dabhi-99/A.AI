# History and usage API

**Implemented in Phase 7.** Types: `packages/shared-types/src/history.ts`, `usage.ts`. Schemas: `packages/validation/src/history.ts`. Design: [ADR-014](../decisions/ADR-014-history-analytics.md).

Signed-in users only: guests get `401 AUTH_REQUIRED` (their chats live in Redis and are not history). Every response is `no-store`. A malformed or someone else's id is `404 NOT_FOUND`.

## Endpoints

| Method | Path                          | Access | Success                        | Purpose                                      |
| ------ | ----------------------------- | ------ | ------------------------------ | -------------------------------------------- |
| GET    | `/api/history`                | User   | `200 HistoryListResponse`      | Chats and comparisons, newest activity first |
| GET    | `/api/conversations/:id/runs` | Owner  | `200 ConversationRunsResponse` | Every run of a chat, including failures      |
| PATCH  | `/api/conversations/:id`      | Owner  | `200 { conversation }`         | Rename and/or pin                            |
| DELETE | `/api/conversations/:id`      | Owner  | `204`                          | Delete permanently with messages and runs    |
| GET    | `/api/comparisons/:id`        | Owner  | `200 ComparisonDetail`         | Reopen a saved comparison                    |
| DELETE | `/api/comparisons/:id`        | Owner  | `204`                          | Delete permanently with its runs             |
| GET    | `/api/usage`                  | User   | `200 UsageReport`              | Your own tokens, cost and latency            |
| GET    | `/api/admin/usage`            | Admin  | `200 UsageReport`              | Deployment totals (aggregates only)          |

## `GET /api/history`

| Query               | Rule                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| `type`              | `all` (default), `conversation`, `comparison`                                  |
| `q`                 | Case-insensitive substring of the title or comparison prompt, ≤ 120 characters |
| `provider`, `model` | Together: only items where some run used this model                            |
| `from`, `to`        | `YYYY-MM-DD` (UTC), inclusive, on last activity                                |
| `limit`             | 1–50, default 20                                                               |
| `cursor`            | `nextCursor` from the previous page                                            |

```json
{
  "items": [
    {
      "kind": "conversation",
      "id": "…",
      "title": "Kyoto trip",
      "createdAt": "2026-09-14T09:00:00.000Z",
      "lastActivityAt": "2026-09-15T09:00:00.000Z",
      "runCount": 3,
      "failedRunCount": 1,
      "models": [{ "provider": "groq", "model": "openai/gpt-oss-20b" }],
      "estimatedCostUsd": 0.0021
    }
  ],
  "nextCursor": "eyJ0Ijoi…"
}
```

- Activity is a chat's last message, or a comparison's latest run. Renaming does not count as activity.
- `estimatedCostUsd` is `null` when no run has a known price, never `0` for "unknown".
- An unreadable cursor is `400 VALIDATION_ERROR`; reload from the first page.
- Message bodies are not searched (ADR-014 §1).

## Run detail

`RunDetail` fields: `status`, answering `provider`/`model`, `requested` (the chosen model when a fallback answered), `attemptCount`, `fallbackReason`, `ttftMs`, `latencyMs`, `inputTokens`, `outputTokens`, `usageSource` (`provider` or `estimated`), `estimatedCostUsd`, `errorCode`, `createdAt`, `completedAt`.

- Chat runs add `messageId` (null for failures).
- Comparison runs add `position` and `content`; they never have `requested` (comparison does not fall back).

## `PATCH /api/conversations/:id`

Renames and/or pins a saved chat (MODEL-062). Send at least one field; unknown fields are rejected (`400`).

```json
{ "title": "Autumn in Kyoto", "pinned": true }
```

| Field    | Rule                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `title`  | Optional. 1–120 characters after trimming                                                                         |
| `pinned` | Optional boolean. `true` sets `pinnedAt` to now (pinning again moves the chat back to the top); `false` clears it |

Neither change counts as activity: `updatedAt` stays the same. The response is the updated `ConversationSummary`:

```json
{
  "conversation": {
    "id": "…",
    "title": "Autumn in Kyoto",
    "pinnedAt": "2026-09-17T12:00:00.000Z",
    "createdAt": "2026-09-14T09:00:00.000Z",
    "updatedAt": "2026-09-14T09:05:00.000Z"
  }
}
```

| Status | Code               | When                                             |
| ------ | ------------------ | ------------------------------------------------ |
| 400    | `VALIDATION_ERROR` | Empty body, blank or long title, non-boolean pin |
| 404    | `NOT_FOUND`        | Unknown, malformed or someone else's id          |

## `GET /api/usage` and `GET /api/admin/usage`

| Query  | Rule                                                  |
| ------ | ----------------------------------------------------- |
| `days` | 1–90, default 30: the last N UTC days including today |

```json
{
  "scope": "personal",
  "range": { "from": "2026-08-17", "to": "2026-09-15", "days": 30 },
  "totals": {
    "runs": 16,
    "completedRuns": 13,
    "failedRuns": 2,
    "cancelledRuns": 1,
    "inputTokens": 1000,
    "outputTokens": 400,
    "providerCountedRuns": 10,
    "estimatedCostUsd": 0.004,
    "costedRuns": 8,
    "averageLatencyMs": 1240,
    "p95LatencyMs": null,
    "fallbackRuns": 1
  },
  "byModel": [
    { "provider": "groq", "model": "openai/gpt-oss-20b", "runs": 16, "…": "same fields as totals" }
  ],
  "byDay": [
    {
      "day": "2026-09-15",
      "runs": 12,
      "failedRuns": 2,
      "inputTokens": 1000,
      "outputTokens": 400,
      "estimatedCostUsd": 0.004
    }
  ],
  "activeUsers": null
}
```

- Covers chat and comparison runs. `failedRuns` counts `FAILED` and `TIMEOUT`.
- `byDay` has every day in the range, including days with no runs.
- `estimatedCostUsd` sums known estimates only; `costedRuns` says how many runs had one. `providerCountedRuns` says how many token counts are exact.
- Latency covers completed runs. `p95LatencyMs` is `null` with fewer than 20 completed runs.
- `/api/admin/usage` (admins; others `403 FORBIDDEN`) has `scope: "deployment"` and `activeUsers`. It never contains prompts, titles, answers or per-user rows.
