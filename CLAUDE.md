# A.ai: instructions for Claude Code

The master blueprint (`docs/blueprint/ModelArena_Master_Implementation_Blueprint_v4.docx`) and `docs/` are the source of truth. Where the blueprint contradicts itself, `docs/decisions/` records the resolution; follow the ADR.

**Product name: A.ai** ([ADR-007](docs/decisions/ADR-007-product-name.md)). The blueprint still says "ModelArena"; never introduce that name. Display text says `A.ai`; packages use the `@a-ai/` scope; storage keys, Redis prefixes and service names use `a-ai`; cookie names use `a_ai_`.

## Before every task (blueprint §22.1)

1. Read the phase file in `docs/development/phase-N.md` and the related `docs/architecture` / `docs/api` pages.
2. Inspect the repository; never assume a file or feature exists.
3. Identify the task ID (`MODEL-XXX`) and its acceptance criteria.
4. Confirm the scope is bounded: one infrastructure concern, route family, provider adapter or UI workflow.

## Rules

- Implement only the requested slice. No placeholder TODOs inside a task marked complete. A stub is incomplete unless it is a declared extension point.
- Never mark a task or phase DONE while a required route, UI state, migration, error path or test is pending. Skipped tests are not passes.
- Infrastructure (ADR-005): Supabase PostgreSQL and Upstash Redis are mandatory. Docker is not used. No in-memory substitute for Redis in application code; tests inject a controlled adapter through `buildApp({ redis })`.
- Routes are thin: validate, identify, authorize, call a service, map the response. Business rules live in services, persistence behind Prisma/repositories, provider HTTP inside `packages/ai-providers`.
- The web app never imports `@a-ai/ai-core`, `@a-ai/ai-providers` or `@a-ai/config/server` (ESLint enforces this).
- Every client-facing error uses the envelope in `packages/shared-types/src/errors.ts`. Unknown errors become `INTERNAL_ERROR` with no message leak.
- New env vars: add to `packages/config/src/server.ts` (or `web.ts`), `.env.example`, and the relevant docs in the same change.
- API contract changes update `packages/shared-types`, `packages/validation` and `docs/api` in the same change.
- Every new Postgres table in Supabase needs Row Level Security enabled (ADR-005), or it is exposed through Supabase's Data API.
- Commits use Conventional Commits (`feat(chat): ...`) and reference the task ID when practical.

## Local facts

- Node 22.13+, pnpm 10. Ports: API 4000, web 5180.
- Workspace packages resolve from source through the `@a-ai/source` export condition (tsc `customConditions`, Vite/Vitest `resolve.conditions`, `tsx --conditions`). Builds resolve `dist`.
- Prisma 7: schema in `prisma/`, config in `prisma.config.ts`, client generated into `apps/api/src/generated/prisma` (git-ignored, regenerated on install).
- Pinned on purpose (ADR-006): TypeScript 6.0 (typescript-eslint does not support 7), Prisma 7.10 (8 is RC), React Router 7, jsdom 29, ioredis 5.

## Checks

```
pnpm verify          # format, lint, typecheck, unit, integration, build
pnpm test:live       # real Supabase + Upstash; required when DB/Redis behavior changes
```

## Completion report (blueprint §22.3)

```
TASK             MODEL-XXX <title>
IMPLEMENTED      - exact path + responsibility
TESTED           - command -> PASS (with counts)
BEHAVIOR VERIFIED - expected behavior; primary error behavior
DATA / MIGRATION migration name or N/A
ENVIRONMENT      variables added/changed or N/A
KNOWN ISSUE      NONE, or blocker/defect with issue ID
NEXT TASK        MODEL-XXX
```

Update the tracker in `docs/development/roadmap.md` with exact paths and test evidence.
