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

## Phase 1: Auth + guest identity (built, awaiting live verification)

**Goal:** every request knows who is calling, a guest or a signed-in user, and limits are enforced on the server.

### Concepts you learn

| Concept                                              | Where to see it                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Password hashing with argon2id                       | `apps/api/src/shared/security/password.ts`                                  |
| Why sessions store an HMAC, not the token            | `apps/api/src/modules/auth/session.service.ts`, `shared/security/tokens.ts` |
| Cookies: HttpOnly, SameSite, `__Host-`               | `apps/api/src/shared/http/cookies.ts`                                       |
| CSRF defence with an origin check                    | `apps/api/src/middleware/origin-check.ts`                                   |
| Not revealing which emails have accounts             | `apps/api/src/modules/auth/auth.service.ts` (`signup`, `login`)             |
| Single-use links with an atomic update               | `apps/api/src/repositories/prisma.repositories.ts` (`consume`)              |
| Repository pattern: swap Prisma for memory in tests  | `src/repositories/types.ts`, `tests/helpers/memory-repositories.ts`         |
| Fixed-window rate limiting in Redis (MULTI/EXEC)     | `apps/api/src/services/kv-store.ts`, `rate-limit.service.ts`                |
| Daily quotas that do not leak allowance on rejection | `apps/api/src/services/quota.service.ts`                                    |
| Resolving guest vs user identity                     | `apps/api/src/plugins/auth.ts`                                              |
| Migrations generated without a database, plus RLS    | `prisma/migrations/20260913140000_auth_accounts/migration.sql`              |
| Forms that share validation with the API             | `packages/validation/src/auth.ts`, `apps/web/src/pages/signup-page.tsx`     |
| Protected routes and safe redirects                  | `apps/web/src/app/require-user.tsx`, `features/auth/form-errors.ts`         |
| Tokens in the URL fragment, removed after reading    | `apps/web/src/features/auth/use-link-token.ts`                              |

### Tests to read

- `apps/api/tests/unit/auth.service.test.ts`: every account rule, one test each.
- `apps/api/tests/integration/auth.test.ts`: the whole flow over HTTP with cookies.
- `apps/api/tests/integration/identity.test.ts`: guests, expired sessions, origin check, rate limit, quota.
- `apps/web/tests/auth-pages.test.tsx`: forms, server errors on fields, redirects.

### Try it (once Supabase and Upstash are in `.env`)

```bash
pnpm db:deploy
```

```bash
pnpm dev
```

1. Open http://localhost:5180/signup and create an account.
2. Without `RESEND_API_KEY`, the verification email is printed in the API terminal. Copy the `/verify-email#token=…` link into the browser.
3. You land signed in; open **Settings** to see your email and daily quota.
4. Sign out, then use **Forgot password** the same way.

**Design:** [guest mode](../architecture/guest-mode.md), [auth API](../api/auth.md), [ADR-008](../decisions/ADR-008-authentication.md).

## Phase 2: Single-model chat (built, awaiting keys and live verification)

**Goal:** chat with one model with the answer streaming in, saved for users and temporary for guests.

### Concepts you learn

| Concept                                               | Where to see it                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| One adapter, many providers (configuration over code) | `packages/ai-providers/src/openai-compatible.ts`, `catalog.ts`                   |
| Connect timeout vs idle timeout on a stream           | `packages/ai-providers/src/http.ts`, `openai-compatible.ts`                      |
| Parsing Server-Sent Events in Node and the browser    | `packages/shared-types/src/sse.ts`                                               |
| Checking everything before the stream opens           | `apps/api/src/modules/chat/chat.service.ts` (`prepare`)                          |
| Recording how every run ended, including Stop         | `chat.service.ts` (`execute`), [ADR-009](../decisions/ADR-009-chat-providers.md) |
| Hijacking a Fastify reply to stream, keeping headers  | `apps/api/src/modules/chat/event-stream.ts`                                      |
| Trimming history to fit a context window              | `apps/api/src/ai/context-builder.ts`                                             |
| Idempotent data migration (guest → account)           | `ChatService.migrateGuest`, `conversation.repository.ts`                         |
| Streaming UI state: optimistic messages, stop, retry  | `apps/web/src/features/chat/use-chat-session.ts`                                 |
| Rendering untrusted Markdown safely                   | `apps/web/src/features/chat/markdown.tsx`                                        |
| Relative TTLs, and why absolute expiry is fragile     | `apps/api/src/services/kv-store.ts`                                              |

### Tests to read

- `packages/ai-providers/tests/openai-compatible.test.ts`: every way a provider stream can go wrong.
- `apps/api/tests/unit/chat.service.test.ts`: the outcome table, one test per row.
- `apps/api/tests/integration/chat.test.ts`: the real SSE response, guests, users and migration.
- `apps/web/tests/chat-page.test.tsx`: streaming, Stop, Retry, quota and hostile Markdown in the UI.

### Try it (needs Supabase, Upstash and one provider key)

```bash
pnpm db:deploy
```

```bash
pnpm dev
```

1. Open http://localhost:5180/chat as a guest and ask something. Watch the answer stream.
2. Press **Stop** during a long answer; the partial text stays.
3. Sign up, verify, and return to **Chat**: your guest chat is now in the sidebar.

**Design:** [chat API](../api/chat.md), [models API](../api/models.md), [provider abstraction](../architecture/provider-abstraction.md).

## Phase 3: Model registry + selector (built, awaiting live verification)

**Goal:** models are data with capabilities and status, not hard-coded names; an admin can change them without a deploy.

### Concepts you learn

| Concept                                                    | Where to see it                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Code defaults seeded into a table, never overwriting edits | `prisma/seed.ts`, `ModelRegistryService` (`#ensureDefaults`)                 |
| Deriving status instead of storing it                      | `apps/api/src/providers/model-registry.service.ts`                           |
| Caching reference data with a short TTL and invalidation   | same file (`REGISTRY_CACHE_TTL_MS`, `invalidate`)                            |
| Role-based access checked on the server                    | `apps/api/src/plugins/auth.ts` (`requireAdmin`)                              |
| Bootstrapping the first admin without a risky endpoint     | `scripts/promote-admin.ts`                                                   |
| Strict partial updates (PATCH) and cross-field validation  | `packages/validation/src/models.ts`                                          |
| Audit logging: who changed what, not the values            | `apps/api/src/modules/models/models.routes.ts`                               |
| Money as nullable decimals; unknown is not zero            | `apps/api/src/ai/cost.ts`, [ADR-010](../decisions/ADR-010-model-registry.md) |
| Sending only changed fields from a form                    | `apps/web/src/features/models/model-card.tsx`                                |

### Tests to read

- `apps/api/tests/unit/model-registry.service.test.ts`: status rules, cache, defaults, update checks.
- `apps/api/tests/integration/models.test.ts`: 401/403/404/400 on the admin API and a real PATCH.
- `apps/web/tests/models-page.test.tsx`: public view, admin disable and edit.

### Try it (needs Supabase)

```bash
pnpm db:deploy
```

```bash
pnpm admin:promote you@example.com
```

1. Run `pnpm dev`, sign in as that account and open http://localhost:5180/models.
2. Disable a model; open **Chat** and see it gone from the picker.
3. Set a price, send a message, and look at `estimated_cost_usd` on the new `model_runs` row.

**Design:** [models API](../api/models.md), [ADR-010](../decisions/ADR-010-model-registry.md).

## Phase 4: Comparison engine

**Goal:** the core of A.ai. One prompt runs on several models in parallel, and one failure never breaks the others.

- **Learn:** `Promise.allSettled`, per-task timeouts, multiplexing several streams on one connection, resilient UI columns.
- **Where:** `apps/api/src/modules/comparison` (service, routes, guest store), `apps/api/src/repositories/comparison.repository.ts`, `apps/web/src/features/compare`, `apps/web/src/pages/compare-page.tsx`.
- **Read first:** `ComparisonService.#execute`: one `AbortController` per run, the request's abort forwarded to all of them, a timer that aborts only its own run, and `Promise.allSettled` in `#prepared`.
- **See it work:** sign in, open `/compare`, pick four models with one provider key deliberately wrong; three columns finish, one shows an error card with Retry. The unit test `comparison.service.test.ts` shows the same with scripted providers.
- **Design:** [comparison engine](../architecture/comparison-engine.md), [ADR-011](../decisions/ADR-011-comparison-engine.md), [comparison API](../api/comparison.md).

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
