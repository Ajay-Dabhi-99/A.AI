# ADR-008: Own authentication in Fastify with revocable sessions

**Status:** Accepted (2026-09-13, Phase 1)

## Context

Phase 1 needs sign-up, sign-in, email verification and password reset. The options were Supabase Auth or authentication owned by the API. The blueprint specifies API-owned auth with Prisma tables and HTTP-only cookies.

## Decision

Authentication lives in `apps/api/src/modules/auth`, persisted in Supabase PostgreSQL through Prisma (`users`, `sessions`, `auth_tokens`).

### Passwords

- Argon2id via `@node-rs/argon2`, OWASP baseline: 19 MiB memory, 2 iterations, parallelism 1 (`src/shared/security/password.ts`).
- Length 10–128, and not equal to the email (`packages/validation/src/auth.ts`). Login does not re-apply the length rule.

### Sessions

- Opaque random token (32 bytes) in an HTTP-only cookie. The database stores only `HMAC-SHA256(JWT_SECRET, token)`, so a leaked table cannot be replayed.
- 30-day sliding expiry, refreshed at most once per day (`session.service.ts`).
- Revocable: logout revokes one session, "sign out everywhere" and password reset revoke all.
- Cookies: `HttpOnly`, `SameSite=Lax`, `Path=/`; in production `Secure` with the `__Host-` prefix (`src/shared/http/cookies.ts`).
- `JWT_SECRET` keys every HMAC with a purpose prefix (session, email-link, ip, email-address). Rotating it signs everyone out and invalidates open links. No JWTs are issued.

### CSRF

`SameSite=Lax` plus an origin check: state-changing `/api` requests with an `Origin` header outside `CORS_ORIGIN` are rejected with `FORBIDDEN` (`src/middleware/origin-check.ts`).

### Account enumeration

- Signup, resend-verification and forgot-password always return `202 {"status":"accepted"}`.
- Signup hashes the password on every path, so response time does not reveal whether the email exists. An existing verified account receives an "account already exists" email instead.
- Login returns one message for unknown emails and wrong passwords, and runs a dummy hash for unknown emails. `EMAIL_NOT_VERIFIED` is only returned after the password is correct.

### Email links

- Verification (24 h) and reset (1 h) tokens are single use. Consumption is one conditional `UPDATE`, so two concurrent clicks cannot both succeed.
- Tokens travel in the URL **fragment** (`/verify-email#token=…`), which browsers never send to servers or in `Referer`. The web app removes it from the address bar after reading it.
- Issuing a new link invalidates older ones of the same type.
- Password reset also verifies the email (the link proves inbox access) and sends a "password changed" notice.

### Email delivery

- Resend REST API (`src/services/email/email-sender.ts`). `RESEND_API_KEY` is required in production.
- Development and test without a key: emails are written to the API log so flows can be completed locally.
- Delivery failures are logged and not surfaced, so responses stay identical; the user can request another link.

### Rate limits (Upstash, fixed window)

| Rule                                           | Limit           |
| ---------------------------------------------- | --------------- |
| Any `/api` request per IP                      | 300 / minute    |
| Login per IP                                   | 20 / 15 minutes |
| Login per email                                | 10 / 15 minutes |
| Signup per IP                                  | 10 / hour       |
| Emails to one address (signup, resend, forgot) | 3 / hour        |
| Email requests per IP                          | 20 / hour       |
| Link submissions per IP                        | 30 / 15 minutes |

IPs and emails are HMAC-hashed before becoming Redis keys.

## Known residual risk

**Pre-registration with a victim's email.** For an unverified account, the latest signup's password wins and older links stop working. If an attacker signs up with a victim's email _after_ the victim, the victim receives a second verification email, and clicking it would verify the attacker's password. The email says to ignore it if you did not just sign up, and the victim can reset the password at any time, which revokes every session. Eliminating this entirely would require choosing the password after verification; revisit if abuse appears.

## Not in Phase 1

Google sign-in, two-factor authentication, account deletion and data export, a session list UI, and guest-to-user migration (there is no guest data to migrate until Phase 2 chat).

## Consequences

- More code to own than Supabase Auth, but identity stays portable and inside the provider-independent API.
- Every auth table is covered by the live suite (`apps/api/tests/live/auth-repositories.test.ts`), including RLS.
