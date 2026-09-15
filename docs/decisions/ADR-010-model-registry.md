# ADR-010: Database model registry, admin role, estimated run cost

**Status:** Accepted (2026-09-14, Phase 3)

## Context

Phase 2 shipped a static model catalog in code ([ADR-009 §3](ADR-009-chat-providers.md#3-a-dated-static-model-catalog)). Model IDs are the most perishable data in the system: providers rename, shut down and re-price models without notice. Changing one should not need a deploy. Phase 3 also has to show every model's capabilities, limits and status, and the UI must not hard-code provider names.

## Decisions

### 1. `model_registry` table, code catalog as seed

- One row per `(provider, model_id)` (unique). Columns: name, category, limits, capability flags, availability, per-million-token prices (nullable), `enabled`, `sort_order`, `verified_at`.
- `packages/ai-providers/src/catalog.ts` stays the source of **defaults**. `prisma/seed.ts` and the API's first registry read both insert missing defaults with `skipDuplicates`, so an admin's edits are never overwritten and a fresh database works without running the seed.
- RLS is enabled on the table like every other table; only the API's service connection reads it.

### 2. Status is derived, not stored

| Status                    | Rule                                     |
| ------------------------- | ---------------------------------------- |
| `available`               | enabled, and the provider has a key      |
| `disabled`                | an admin turned it off                   |
| `provider_not_configured` | enabled, but no API key for its provider |

Only `available` models appear in `GET /api/models` and can be chosen for chat. `ModelRegistryService.resolve` rejects anything else with `MODEL_UNAVAILABLE`, so a model disabled mid-conversation stops being usable on the next message.

### 3. 30-second in-process cache

Every chat request resolves its model. Reading the table each time adds a database round trip for data that changes a few times a month. The service caches rows for 30 s and invalidates immediately on an admin update in the same process. With several API instances, others see the change within 30 s; that is acceptable for reference data. If this ever needs to be instant, publish an invalidation through Redis.

### 4. Admin role on the user, promoted from the command line

- `users.role` enum `USER | ADMIN`, default `USER`. `AuthUser.role` is returned by `/api/me` so the web app can show admin controls; the API never trusts that and checks with `requireAdmin` (401 for guests, 403 for users).
- There is no route that grants admin. The first admin is promoted by someone with database access: `pnpm admin:promote <email>` (`--revoke` to remove). This avoids a bootstrap endpoint that could be abused.
- Every registry change is logged as `model_registry.updated` with the admin id and the **names** of changed fields.

### 5. Strict, partial updates

`PATCH /api/admin/models/:registryId` accepts only known fields (`.strict()`), requires at least one, and checks `maxOutputTokens < contextWindow` against the stored value when only one of them is sent. `verified: true` stamps `verified_at` with the server clock; `false` clears it. Provider and model id cannot be edited: a renamed model is a new row.

### 6. Estimated cost per run

- Prices are stored in USD per million tokens. `estimateCostUsd` = `(input × inPrice + output × outPrice) / 1e6`, rounded to 6 decimals, saved on `model_runs.estimated_cost_usd`.
- Unknown price or unknown usage → `null`, never `0`. A `0` means the model is known to be free.
- It is labelled "estimated": providers bill on their own token counts and may change prices; the registry records what we believed at the time of the run.

## Consequences

- Retiring or renaming a model is an admin action, not a release.
- Price history is not versioned yet; the run row keeps the estimate computed at the time. Versioned pricing can come with Phase 7 analytics if needed.
- A newly added catalog default only appears after the next deploy (first read inserts it). Removing a default from code does not delete its row; disable it instead.
