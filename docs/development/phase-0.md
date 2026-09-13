# Phase 0: Foundation and architecture

**Gate (blueprint v4 §16):** the app boots, Supabase DB connects, configuration validation passes, and the test harness works. Upstash Redis integration is mandatory. Docker is not required.

**Status: BLOCKED on external credentials.** Everything that can be verified without a Supabase project and an Upstash database passes. The live gate (`pnpm test:live`) cannot run until those exist.

- **Blocker:** no Supabase project or Upstash database is configured for this repository.
- **Owner:** project maintainer.
- **Next action:** create both (plus a separate test project/database), fill `.env`, run `pnpm check:env` and `pnpm test:live`.

## Tasks

### MODEL-001: Initialize monorepo

- `package.json`, `pnpm-workspace.yaml`, `turbo.json`: workspaces, task graph, scripts (`verify`, `test:*`, `db:*`, `check:env`)
- `packages/config/tsconfig.{base,node,react}.json`: strict TypeScript presets
- `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitignore`, `LICENSE`
- `.env.example`: every variable, with where to obtain it

### MODEL-002: Configure React application

- `apps/web/vite.config.ts`: port 5180, API proxy, source-condition resolution, Vitest config
- `apps/web/src/styles/globals.css`: design tokens (light/dark, AA contrast), Tailwind v4 theme, reduced-motion rules
- `apps/web/src/app/*`: router, providers (TanStack Query), root layout with skip link
- `apps/web/src/components/{ui,layout}/*`: Button, Badge, Logo, header, footer, theme toggle, API status pill
- `apps/web/src/features/landing/*`: hero, animated comparison preview, features, how it works
- `apps/web/src/services/api.ts`, `hooks/use-api-status.ts`: typed readiness client (`ApiError`, `NetworkError`)
- `apps/web/src/stores/theme-store.ts`: system/light/dark preference

### MODEL-003: Configure Fastify API

- `apps/api/src/app.ts`: composition root with test seams for Prisma and Redis
- `apps/api/src/server.ts`: env validation, listen, graceful shutdown
- `apps/api/src/plugins/observability.ts`: request IDs, structured logs, error and 404 handlers
- `apps/api/src/plugins/cors.ts`: helmet + exact-origin CORS
- `apps/api/src/shared/errors/*`: `AppError`, HTTP mapping, `toApiError`
- `apps/api/src/modules/health/*`: `/health`, `/ready`

### MODEL-004: Configure Prisma

- `prisma/schema.prisma`: Prisma 7 `prisma-client` generator, ESM output with `.js` imports
- `prisma.config.ts`: migrations use `DIRECT_URL`
- `prisma/seed.ts`: connectivity seed (registry seed arrives in Phase 3)
- `apps/api/src/plugins/prisma.ts`: pg adapter, lazy connect, disconnect on close

No tables yet: users/sessions belong to MODEL-006 (Phase 1).

### MODEL-005: Supabase + Upstash connectivity

- `packages/config/src/server.ts`: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` (production requires `rediss://`)
- `apps/api/src/plugins/redis.ts`: ioredis with capped backoff and throttled error logs
- `apps/api/src/modules/health/health.service.ts`: probes with timeout; provider configuration check
- `apps/api/tests/live/infrastructure.test.ts`: real `SELECT 1`, Redis TTL expiry, atomic counters, `/ready` 200

### MODEL-008: AI provider interface

- `packages/ai-core/src/*`: `AIProvider`, `ProviderRegistry`, `AIProviderError`
- `packages/ai-providers/src/*`: `providerFetch`, `classifyHttpStatus`, `parseRetryAfter`, `parseSseStream`
- `packages/shared-types/src/*`: AI, error, health and stream types
- `packages/validation/src/*`: error envelope and health schemas

Extension point by design (blueprint §22.5): no concrete adapter exists until Phase 2.

### MODEL-015: CI and GitHub process

- `.github/workflows/ci.yml`: format, lint, typecheck, unit, integration, build on every PR
- `.github/workflows/test.yml`: live Supabase/Upstash suite on `develop`/`main`
- `.github/workflows/deploy.yml`: full gate, then deploy hooks (hooks configured in Phase 10)
- `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`

## Verification

Run on 2026-09-13, Windows 11, Node 22.16.0, pnpm 10.34.5.

| Check                          | Command                                    | Result                                                                                               |
| ------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Format                         | `pnpm format:check`                        | PASS                                                                                                 |
| Lint                           | `pnpm lint`                                | PASS                                                                                                 |
| Typecheck                      | `pnpm typecheck`                           | PASS (7 workspaces + root scripts)                                                                   |
| Unit                           | `pnpm test:unit`                           | PASS, 76 tests (config 13, shared-types 3, ai-core 4, validation 4, ai-providers 22, api 15, web 15) |
| Integration                    | `pnpm test:integration`                    | PASS, 15 tests                                                                                       |
| Build                          | `pnpm build`                               | PASS (packages, API, web)                                                                            |
| API boots and serves `/health` | `pnpm dev:api` then `GET /health`          | PASS: 200, security headers, `x-request-id`                                                          |
| Readiness failure path         | `GET /ready` with unreachable DB/Redis     | PASS: 503, `unreachable` / `timed out after 2000ms`, logs carry only error codes                     |
| Web renders                    | `pnpm dev` then open http://localhost:5180 | PASS: hero, preview, features, how it works, 404; light/dark toggle; pill shows Partial outage       |
| Live Supabase + Upstash        | `pnpm test:live`                           | **NOT RUN: credentials not available**                                                               |

## Defects found during manual QA

| Severity | Issue                                                                             | Status                                                    |
| -------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P3       | Features grid showed a grey block while cards faded in (gap-as-border background) | Fixed: cards carry their own borders (`feature-grid.tsx`) |

No open P0/P1/P2 defects. Phase 0 becomes DONE when `pnpm check:env` and `pnpm test:live` pass against real Supabase and Upstash.
