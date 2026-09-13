# ADR-007: Product name A.ai

**Status:** Accepted (2026-09-13)

## Context

The blueprint names the product ModelArena. Before the first commit, the product was renamed to **A.ai**.

## Decision

| Where                                         | Value                                            |
| --------------------------------------------- | ------------------------------------------------ |
| Display name (UI, docs, page titles, license) | `A.ai`                                           |
| npm package scope                             | `@a-ai/*` (npm scope names cannot contain a dot) |
| Custom export condition                       | `@a-ai/source`                                   |
| Root package name                             | `a-ai`                                           |
| API service name (`/health`)                  | `a-ai-api`                                       |
| Browser storage keys                          | `a-ai-*` (e.g. `a-ai-theme`)                     |
| Suggested GitHub repository name              | `a-ai`                                           |
| Local folder                                  | `H:\AI Arena` (unchanged)                        |

The blueprint document keeps its original file name (`docs/blueprint/ModelArena_Master_Implementation_Blueprint_v4.docx`). Wherever it says ModelArena, read A.ai.

Brand-flavoured identifiers were renamed with it: `ArenaRace` → `ModelRace` (`apps/web/src/features/landing/model-race.tsx`), `arena-grid`/`arena-glow` → `hero-grid`/`hero-glow`.

## Rules for all later phases

- New user-facing text says **A.ai**. New packages use the `@a-ai/` scope; new storage keys, cookies and Redis key prefixes use `a-ai`.
- Cookie names introduced in Phase 1 should be prefixed `a_ai_` (cookie names cannot safely contain dots).

## Consequences

- "A.ai" reads like a domain. Single-letter `.ai` domains are premium and very likely registered already, so the real production domain must be confirmed before Phase 1 fixes cookie scope (see [blueprint review](../development/blueprint-review.md) items 1 and 19).
- A trademark search is still needed before public launch.
