# Phase 1: Auth + guest identity

**Gate (blueprint §16):** guest and user identity both reach the API correctly; unauthorized and expired states are tested.

**Scope agreed on 2026-09-13:** API-owned auth (not Supabase Auth); email + password; email verification and password reset. Google sign-in is out of scope. Design: [ADR-008](../decisions/ADR-008-authentication.md).

**Status: CODE COMPLETE.** Every check that can run without real infrastructure passes. DONE requires the Phase 0 live gate, then this phase's live suite, E2E and a real-email manual pass.

## Tasks

| ID         | Scope                                                                           | Where                                                                                                    | Status                          |
| ---------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------- |
| MODEL-016  | Storage interface over Upstash; fixed-window rate limiter; per-IP `/api` limit  | `apps/api/src/services/kv-store.ts`, `rate-limit.service.ts`, `src/middleware/rate-limit.ts`             | CODE COMPLETE                   |
| MODEL-006a | `users`, `sessions`, `auth_tokens` schema and migration with RLS                | `prisma/schema.prisma`, `prisma/migrations/20260913140000_auth_accounts`                                 | CODE COMPLETE (not yet applied) |
| MODEL-006b | Repositories, argon2id, sessions, auth service, auth routes, origin check       | `apps/api/src/repositories`, `src/shared/security`, `src/modules/auth`, `src/middleware/origin-check.ts` | CODE COMPLETE                   |
| MODEL-018  | Email verification and password reset; Resend sender, dev log sender, templates | `apps/api/src/services/email`, `src/modules/auth/auth.service.ts`                                        | CODE COMPLETE                   |
| MODEL-007a | Guest sessions in Redis with TTL                                                | `apps/api/src/modules/guest/guest.service.ts`                                                            | CODE COMPLETE                   |
| MODEL-007b | Identity resolver, `requireUser`, `GET /api/me`                                 | `apps/api/src/plugins/auth.ts`, `src/modules/users/me.routes.ts`                                         | CODE COMPLETE                   |
| MODEL-007c | Daily quota service (user, guest, guest-per-IP)                                 | `apps/api/src/services/quota.service.ts`                                                                 | CODE COMPLETE                   |
| MODEL-006c | Web: login, signup, verify, forgot, reset, protected settings, header account   | `apps/web/src/pages`, `src/features/auth`, `src/app/require-user.tsx`                                    | CODE COMPLETE                   |

Shared contracts: `packages/shared-types/src/auth.ts`, `packages/validation/src/auth.ts`, new error codes in `packages/shared-types/src/errors.ts`. New env: `APP_URL`, `USER_DAILY_MESSAGE_LIMIT`, `EMAIL_FROM`, `RESEND_API_KEY`, `TEST_DIRECT_URL`.

## Verification

Run on 2026-09-13, Windows 11, Node 22.16.0, pnpm 10.34.5.

| Check                                      | Command                                    | Result                                                                                                 |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Format, lint, typecheck, build             | `pnpm verify`                              | PASS                                                                                                   |
| Unit                                       | `pnpm test:unit`                           | PASS, 147 tests (config 15, shared-types 3, ai-core 4, validation 12, ai-providers 22, api 58, web 33) |
| Integration                                | `pnpm test:integration`                    | PASS, 32 tests (health 5, platform 10, auth 10, identity 7)                                            |
| Web pages render                           | `pnpm dev`, open `/login`, `/signup`       | PASS: forms render in both themes; empty submit shows field errors with `aria-invalid`                 |
| API without Redis                          | `GET /api/me` with unreachable `REDIS_URL` | PASS after fix: clean `500` envelope, bounded by a 2 s Redis command timeout                           |
| Live: migration + repositories + RLS       | `pnpm test:live`                           | **NOT RUN: needs Supabase + Upstash**                                                                  |
| E2E: signup → verify → settings → logout   | Playwright                                 | **NOT STARTED: needs a real database**                                                                 |
| Manual: real verification and reset emails | Resend key + inbox                         | **NOT RUN**                                                                                            |

## Defects found and fixed during Phase 1 QA

| Severity        | Issue                                                                                      | Fix                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| P2              | Without Redis, API requests stalled 2–15 s before failing (ioredis offline queue)          | `commandTimeout: 2_000` in `apps/api/src/plugins/redis.ts`                             |
| P3              | `/settings` sent users to the login page when the session check failed with a server error | `RequireUser` shows a retry for any failed check; only a confirmed guest is redirected |
| P3 (tests only) | `ioredis-mock` shared data between test apps, leaking rate-limit counters                  | Each controlled Redis gets its own port (`tests/helpers/test-app.ts`)                  |

## Failure paths covered by tests

- Wrong password vs unknown email: same status and message (`auth.test.ts`, `auth.service.test.ts`).
- Unverified login, reused and expired verification and reset links, concurrent signups for one email.
- Tampered, expired and revoked session cookies fall back to guest and are cleared (`identity.test.ts`).
- Expired or unknown guest cookie replaced; guest over quota gets `QUOTA_EXCEEDED` without using allowance.
- Cross-origin POST blocked; `/api` and login rate limits return `429` with `Retry-After`; health probes are never rate limited.
- Email delivery failure does not change the response and is logged.

## Deferred, by design

- Guest-to-user migration: no guest data exists until Phase 2 chat.
- Google sign-in, 2FA, account deletion: not in the agreed scope.
