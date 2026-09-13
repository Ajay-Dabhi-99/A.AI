# Phase 1: Auth + guest identity

**Gate:** guest and user identity both reach the API correctly; unauthorized and expired states are tested.

**Prerequisite:** Phase 0 DONE (live Supabase + Upstash gate passed).

## Tasks

| ID         | Scope                                                                                                  | Key paths                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| MODEL-016  | Redis storage interface; rate-limit service (Lua, atomic); `@fastify/rate-limit` on the Upstash client | `apps/api/src/services/rate-limit`, `apps/api/src/middleware` |
| MODEL-006a | `users` + `sessions` tables, migration with RLS enabled                                                | `prisma/schema.prisma`, `prisma/migrations`                   |
| MODEL-006b | Signup/login/logout routes, argon2id, session cookie, CSRF origin check                                | `apps/api/src/modules/auth`                                   |
| MODEL-007a | Guest session cookie + `guest:session:*` with TTL                                                      | `apps/api/src/modules/guest`                                  |
| MODEL-007b | Identity resolver (guest or user) decorating every request                                             | `apps/api/src/plugins/auth.ts`                                |
| MODEL-007c | Quota service skeleton: daily guest counter, `QUOTA_EXCEEDED`                                          | `apps/api/src/services/quota`                                 |
| MODEL-006c | Web: login/signup pages, auth store, protected route wrapper, `/api/me`                                | `apps/web/src/features/auth`, `apps/web/src/pages`            |

## Must-test failure paths

- Expired and tampered session cookies → treated as anonymous, new guest session.
- Wrong password → generic message, no user enumeration, rate limited.
- Guest over quota → 429 `QUOTA_EXCEEDED`, counter unchanged by rejected calls.
- Redis unavailable → requests needing quota fail with a clear error; `/ready` 503.
- Rate limit survives an API restart (state lives in Upstash, verified by the live suite).

## First E2E

Playwright is introduced here: guest visit → identity issued; signup → session; logout → guest again.
