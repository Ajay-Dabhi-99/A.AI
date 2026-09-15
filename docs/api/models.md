# Models API

**Phase 3 (MODEL-013): database-backed registry.** Design: [ADR-010](../decisions/ADR-010-model-registry.md).

## `GET /api/models`

Models that can be used for chat right now.

```json
{
  "models": [
    {
      "id": "openai/gpt-oss-120b",
      "provider": "groq",
      "name": "GPT-OSS 120B",
      "category": "text",
      "contextWindow": 131072,
      "maxOutputTokens": 65536,
      "supportsStreaming": true,
      "supportsVision": false,
      "supportsTools": true,
      "availability": "free-tier",
      "inputPricePerMillionUsd": null,
      "outputPricePerMillionUsd": null
    }
  ],
  "defaultModel": { "provider": "groq", "id": "openai/gpt-oss-120b" },
  "providers": [{ "id": "groq", "name": "Groq", "configured": true }]
}
```

- Only `available` models (enabled, provider key configured), ordered by `sortOrder`. With no keys, `models` is empty and `defaultModel` is `null`.
- `providers` carries display names; the web app never hard-codes them.
- Cached privately by the browser for 60 seconds.

## `GET /api/models/catalog`

Every registry entry, for the public `/models` page. Same `providers`, and each model adds:

| Field        | Meaning                                               |
| ------------ | ----------------------------------------------------- |
| `registryId` | UUID used by the admin API                            |
| `status`     | `available`, `disabled` or `provider_not_configured`  |
| `enabled`    | Admin switch                                          |
| `sortOrder`  | Lower first                                           |
| `verifiedAt` | When limits were confirmed with a real key, or `null` |
| `updatedAt`  | Last change                                           |

## `GET /api/providers/health`

**Phase 6.** Circuit-breaker status per provider, shared by every API instance ([ADR-013](../decisions/ADR-013-fallback-routing.md)). Public, `no-store`.

```json
{
  "providers": [
    {
      "id": "groq",
      "name": "Groq",
      "configured": true,
      "status": "down",
      "consecutiveFailures": 3,
      "lastErrorCode": "PROVIDER_TIMEOUT",
      "retryAt": "2026-09-15T12:00:30.000Z",
      "lastFailureAt": "2026-09-15T12:00:00.000Z",
      "lastSuccessAt": "2026-09-15T11:58:10.000Z"
    }
  ]
}
```

| `status`         | Meaning                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `healthy`        | No provider failures since the last success                                                          |
| `degraded`       | Failing, below the threshold; still used                                                             |
| `down`           | 3 consecutive failures (30 s) or a 429 `Retry-After` (≤ 60 s); skipped as a fallback until `retryAt` |
| `not_configured` | No API key for this provider                                                                         |

Only error codes are exposed, never provider messages. `/ready` does not depend on provider health.

## Admin endpoints

Both need a signed-in user with the admin role: guests get `401 AUTH_REQUIRED`, other users `403 FORBIDDEN`. Responses are `no-store`.

### `GET /api/admin/models`

Same body as `/api/models/catalog`, never cached.

### `PATCH /api/admin/models/:registryId`

Send only the fields that change; at least one is required and unknown fields are rejected.

| Field                      | Rule                                                     |
| -------------------------- | -------------------------------------------------------- |
| `name`                     | 1–120 characters                                         |
| `enabled`                  | boolean                                                  |
| `sortOrder`                | integer 0–100,000                                        |
| `contextWindow`            | integer 1,000–10,000,000                                 |
| `maxOutputTokens`          | integer, smaller than the (new or stored) context window |
| `availability`             | `free`, `free-tier`, `paid`                              |
| `inputPricePerMillionUsd`  | 0–10,000 or `null` (unknown)                             |
| `outputPricePerMillionUsd` | 0–10,000 or `null` (unknown)                             |
| `verified`                 | `true` sets `verifiedAt` to now; `false` clears it       |

```json
{ "enabled": false }
```

Returns `{ "model": CatalogModel }`. Errors: `VALIDATION_ERROR` (400, with `details`), `NOT_FOUND` (404, unknown or malformed id). Each change is logged as `model_registry.updated` with the admin id and changed field names.

## Making the first admin

No API grants the role. With `DATABASE_URL` set and the account already created:

```bash
pnpm admin:promote person@example.com
```

```bash
pnpm admin:promote person@example.com --revoke
```

Sign out and in again (or reload) so `/api/me` returns `"role": "admin"`.

## Cost estimates

Each chat run stores `estimated_cost_usd` = `(inputTokens × input price + outputTokens × output price) / 1,000,000`, rounded to 6 decimals. It is `null` when a price or the usage is unknown. OpenRouter `:free` models default to `0`.

## Default catalog

Source: `packages/ai-providers/src/catalog.ts`, checked on 2026-09-13 ([ADR-009](../decisions/ADR-009-chat-providers.md#3-a-dated-static-model-catalog)). Inserted into `model_registry` by `pnpm db:seed` or on the API's first registry read; existing rows are never overwritten.

| Provider   | Model id                                 | Context                | Price   | Notes                   |
| ---------- | ---------------------------------------- | ---------------------- | ------- | ----------------------- |
| Groq       | `openai/gpt-oss-120b`                    | 131,072                | not set |                         |
| Groq       | `openai/gpt-oss-20b`                     | 131,072                | not set |                         |
| OpenRouter | `google/gemma-4-31b-it:free`             | 262,144                | $0      | Free variant            |
| OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free` | 262,144                | $0      | Free variant            |
| Gemini     | `gemini-3.8-flash`                       | 1,048,576 (unverified) | not set | Confirm with a real key |
| Gemini     | `gemini-3.5-flash-lite`                  | 1,048,576 (unverified) | not set | Confirm with a real key |
