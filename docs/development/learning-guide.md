# Learning guide: what each phase builds, and where

This guide is for learning the codebase phase by phase. Each phase lists what you build, the concepts you learn, the files to read first, and how to see it working yourself.

## How to read this repository

1. Start at `apps/api/src/app.ts`. It is the whole API on one screen: what runs, in what order.
2. Follow one request: `server.ts` → `app.ts` → `plugins/observability.ts` → `modules/health/health.routes.ts` → `health.service.ts`.
3. Then open `apps/web/src/main.tsx` → `app/router.tsx` → `pages/landing-page.tsx`.
4. Shared contracts are in `packages/shared-types`. When the API and web app agree on a shape, it is defined there.

---

## Phase 0: Foundation (built)

**Goal:** a monorepo where the API boots, the web app renders, configuration is validated, infrastructure is health-checked, and tests and CI work. No product features yet.

### Concepts you learn

| Concept                                                     | Where to see it                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Monorepo workspaces and a task graph                        | `pnpm-workspace.yaml`, `turbo.json`                                              |
| Resolving packages from source in dev, `dist` in production | `packages/*/package.json` `exports`, [ADR-004](../decisions/ADR-004-monorepo.md) |
| Failing fast on bad configuration                           | `packages/config/src/server.ts`, `scripts/check-env.ts`                          |
| Composition root and dependency injection for tests         | `apps/api/src/app.ts` (`buildApp({ prisma, redis })`)                            |
| Liveness vs readiness                                       | `apps/api/src/modules/health/*`                                                  |
| Request correlation and structured logging                  | `apps/api/src/plugins/observability.ts`                                          |
| One error envelope; never leaking internals                 | `apps/api/src/shared/errors/to-api-error.ts`                                     |
| CORS with credentials, security headers                     | `apps/api/src/plugins/cors.ts`                                                   |
| Driver adapters in Prisma 7                                 | `apps/api/src/plugins/prisma.ts`, `prisma.config.ts`                             |
| Timeouts and cancellation with `AbortSignal`                | `packages/ai-providers/src/http.ts`                                              |
| Parsing a byte stream incrementally                         | `packages/ai-providers/src/sse.ts`                                               |
| Design tokens and theming without flash                     | `apps/web/src/styles/globals.css`, `apps/web/index.html`                         |
| Animation that respects performance and reduced motion      | `apps/web/src/features/landing/model-race.tsx`                                   |
| Server state vs client state                                | `hooks/use-api-status.ts` (TanStack Query) vs `stores/theme-store.ts` (Zustand)  |

### Try it

```bash
pnpm install
pnpm verify
```

```bash
pnpm dev
```

- Open http://localhost:5180. The status pill in the header shows the real `/ready` result.
- Open http://localhost:4000/ready. With no Supabase/Upstash credentials it returns 503 and says which dependency is down. That is the readiness check doing its job.
- Change a color token in `globals.css` and watch both themes update.

### Tests to read

- `apps/api/tests/integration/health.test.ts`: how readiness behaves when each dependency fails.
- `apps/api/tests/integration/platform.test.ts`: request IDs, error envelope, CORS, security headers.
- `packages/ai-providers/tests/sse.test.ts`: edge cases a naive stream parser gets wrong.

---

## Phase 1: Auth + guest identity

**Goal:** every request knows who is calling, a guest or a signed-in user, and limits are enforced on the server.

- **Learn:** password hashing (argon2id), session cookies (HttpOnly, Secure, SameSite), CSRF, Redis TTLs, atomic counters with Lua, rate-limiting algorithms, database migrations, Row Level Security in Supabase.
- **Where:** `apps/api/src/modules/auth`, `modules/guest`, `plugins/auth.ts`, `services/quota`, `services/rate-limit`, `prisma/migrations`, `apps/web/src/features/auth`.
- **See it work:** sign up, sign out, exceed the guest limit and get `QUOTA_EXCEEDED`; restart the API and confirm the limit still holds.
- **Design:** [guest mode](../architecture/guest-mode.md), [auth API](../api/auth.md).

## Phase 2: Single-model chat

**Goal:** chat with one model with the answer streaming in.

- **Learn:** adapter pattern, Server-Sent Events over `fetch`, backpressure and client disconnects, persisting conversations, rendering untrusted markdown safely.
- **Where:** `packages/ai-providers/src/{groq,openrouter,gemini}`, `apps/api/src/modules/chat`, `apps/api/src/repositories`, `apps/web/src/features/chat`.
- **See it work:** send a message, press Stop mid-stream, kill the network and watch the retry state.
- **Design:** [chat API](../api/chat.md), [provider abstraction](../architecture/provider-abstraction.md).

## Phase 3: Model registry + selector

**Goal:** models are data with capabilities, not hard-coded names.

- **Learn:** capability-based UI, seeding, caching reference data.
- **Where:** `prisma/seed.ts`, `apps/api/src/modules/models`, `apps/web/src/features/models`.
- **Design:** [models API](../api/models.md).

## Phase 4: Comparison engine

**Goal:** the core of A.ai. One prompt runs on several models in parallel, and one failure never breaks the others.

- **Learn:** `Promise.allSettled`, per-task timeouts, multiplexing several streams on one connection, resilient UI columns.
- **Where:** `apps/api/src/modules/comparison`, `apps/web/src/features/comparison`.
- **See it work:** compare four models with one provider key deliberately wrong; three columns finish, one shows an error card.
- **Design:** [comparison engine](../architecture/comparison-engine.md).

## Phase 5: Context + token management

- **Learn:** token budgets, deterministic trimming, summarization, cache invalidation.
- **Where:** `apps/api/src/ai/token.service.ts`, `apps/api/src/services/context.service.ts`.
- **Design:** [context management](../architecture/context-management.md).

## Phase 6: Fallback + routing

- **Learn:** retries with backoff and jitter, circuit breakers, provider health scoring, deterministic fallback rules.
- **Where:** `apps/api/src/ai/model-router.ts`, `apps/api/src/ai/fallback.service.ts`.

## Phase 7: History + analytics

- **Learn:** pagination, search, aggregate queries, charts that tell the truth.
- **Where:** `apps/api/src/modules/conversations`, `modules/usage`, `apps/web/src/features/history`.

## Phase 8: Vision + image

- **Learn:** secure uploads (type sniffing, size limits), object storage with signed URLs, async job pattern.
- **Where:** `apps/api/src/modules/image`, `apps/web/src/features/image`.

## Phase 9: Video + audio

- **Learn:** long-running jobs that survive refresh, polling vs push, speech-to-text and text-to-speech pipelines.
- **Where:** `apps/api/src/modules/{video,audio}`, `apps/web/src/features/{video,audio}`.

## Phase 10: Hardening + deployment

- **Learn:** security review, load testing, error monitoring, backups, rollback, custom domains and cookies across subdomains.
- **Where:** `.github/workflows/deploy.yml`, `docs/development/release-checklist.md`.

---

## Working rhythm for every task

1. Open or create the GitHub issue `MODEL-XXX` using the task template.
2. Branch: `feature/p<phase>-<scope>-MODEL-XXX` from `develop`.
3. Implement the smallest complete slice, with tests beside the code.
4. `pnpm verify` (and `pnpm test:live` if you touched database or Redis behavior).
5. Open a PR using the template; CI must be green.
6. Update `docs/development/roadmap.md` with paths and test evidence.
