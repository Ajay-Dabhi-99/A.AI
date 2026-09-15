# Phase 3: Model registry + selector

**Gate (blueprint §16):** models are data with capabilities and status; the UI never hard-codes providers.

**Status: CODE COMPLETE.** Every check that can run without real infrastructure passes. DONE requires the earlier live gates, the migration applied, this phase's live suite, and one admin change verified end to end.

Design: [ADR-010](../decisions/ADR-010-model-registry.md). API: [models](../api/models.md), [auth](../api/auth.md) (`role`).

## Tasks

| ID         | Scope                                                                          | Where                                                                                                        | Status                                |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| MODEL-013a | `model_registry` table and `users.role`, with RLS; seed from catalog defaults  | `prisma/schema.prisma`, `prisma/migrations/20260914120000_model_registry_roles`, `prisma/seed.ts`            | CODE COMPLETE (migration not applied) |
| MODEL-013b | Registry repository and service: status, 30 s cache, resolve, update           | `apps/api/src/repositories/model-registry.repository.ts`, `apps/api/src/providers/model-registry.service.ts` | CODE COMPLETE                         |
| MODEL-013c | Chat resolves models through the registry                                      | `apps/api/src/modules/chat/chat.service.ts`, `src/services/container.ts`                                     | CODE COMPLETE                         |
| MODEL-020  | Admin role: `requireAdmin`, `pnpm admin:promote`, audit log                    | `apps/api/src/plugins/auth.ts`, `scripts/promote-admin.ts`                                                   | CODE COMPLETE                         |
| MODEL-021  | Models API: public list, catalog, admin list and PATCH                         | `apps/api/src/modules/models/models.routes.ts`, `packages/validation/src/models.ts`                          | CODE COMPLETE                         |
| MODEL-022  | Per-million-token prices and estimated cost per run                            | `packages/ai-providers/src/catalog.ts`, `apps/api/src/ai/cost.ts`, `conversation.repository.ts`              | CODE COMPLETE                         |
| MODEL-023  | Web `/models` page with admin enable/disable and edit; provider names from API | `apps/web/src/pages/models-page.tsx`, `src/features/models/model-card.tsx`, `src/features/chat/composer.tsx` | CODE COMPLETE                         |

## Verification

Run on 2026-09-14, Windows 11, Node 22.16.0, pnpm 10.34.5.

| Check                                         | Command                               | Result                                                                                                  |
| --------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck (7 workspaces), build | `pnpm verify`                         | PASS                                                                                                    |
| Unit                                          | `pnpm test:unit`                      | PASS, 227 tests (config 15, shared-types 9, ai-core 4, validation 22, ai-providers 31, api 96, web 50)  |
| Integration                                   | `pnpm test:integration`               | PASS, 47 tests (health 6, platform 9, auth 10, identity 7, chat 7, models 8)                            |
| Models UI behaviour                           | `apps/web/tests/models-page.test.tsx` | PASS, 6 tests (public view, load error, disable, changed-fields-only save, limit check, refused change) |
| Migration SQL                                 | `prisma migrate diff`                 | Generated from the Phase 2 schema; RLS statement appended                                               |
| Live: registry repository, role, cost column  | `pnpm test:live`                      | **NOT RUN: needs Supabase + Upstash**                                                                   |
| Promote an admin and disable a model          | `pnpm admin:promote`, `/models`       | **NOT RUN: needs Supabase**                                                                             |

## Defects found and fixed during Phase 3

| Severity        | Issue                                                                                | Fix                                                           |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| P3              | Composer kept a local `providers` list that shadowed the new `providers` prop        | Renamed to `providerIds`; labels come from the prop           |
| P3 (tests only) | Tests read registry rows before the first read inserted defaults                     | Tests read through `models.catalog()` or make a first request |
| P3 (tests only) | Integration suites' first test exceeded Vitest's 5 s default on a cold Windows start | Integration timeout raised to 20 s                            |

## Failure paths covered by tests

- Disabled model or provider without a key: excluded from `/api/models`; chat rejects it with `MODEL_UNAVAILABLE` before streaming.
- Admin routes as guest (401) and as a normal user (403); malformed or unknown registry id (404).
- Unknown PATCH fields, empty body, negative price, output limit not below the stored context window (400).
- Cost: unknown price or usage stays `null`; free models record `0`.
- Default insertion failure is retried on the next read instead of being cached.
- Admin UI: invalid limits never reach the API; server refusal shown on the card.

## Deferred, by design

- Versioned price history and per-model free-tier request limits: Phase 7 (analytics) if needed.
- Cross-instance cache invalidation through Redis: only if 30 s staleness becomes a problem.
- Capability filters in the selector (vision, tools): Phase 8, when those capabilities are used.
