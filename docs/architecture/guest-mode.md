# Guest mode

**Implemented in Phase 1** (identity, session, quota). Guest-to-user migration arrives with Phase 2, when guests first have conversations to migrate.

Blueprint §2, §8, §13 and the v4 infrastructure decision; [ADR-002](../decisions/ADR-002-guest-session.md), [ADR-008](../decisions/ADR-008-authentication.md).

## Identity resolution

`apps/api/src/plugins/auth.ts` → `resolveIdentity(request, reply, { createGuest })`:

1. A valid `a_ai_session` cookie → **user**. An invalid or expired one is cleared.
2. Otherwise a valid `a_ai_guest` cookie → **guest**. An invalid or expired one is cleared.
3. Otherwise, with `createGuest: true`, a new guest session is created and its cookie set.

`GET /api/me` resolves with `createGuest: true`, so the first page load gives every visitor an identity. Routes that need an account call `requireUser`, which throws `AUTH_REQUIRED`.

## Redis keys (Upstash, all prefixed `a-ai:`)

| Key                                             | Value                          | Expiry                      |
| ----------------------------------------------- | ------------------------------ | --------------------------- |
| `guest:session:{guestId}`                       | `{ id, createdAt, expiresAt }` | `GUEST_SESSION_TTL_MINUTES` |
| `quota:messages:guest:{guestId}:{yyyy-mm-dd}`   | message counter                | next UTC midnight + 1 h     |
| `quota:messages:guest-ip:{ipHash}:{yyyy-mm-dd}` | message counter per IP         | next UTC midnight + 1 h     |
| `quota:messages:user:{userId}:{yyyy-mm-dd}`     | message counter                | next UTC midnight + 1 h     |
| `guest:comparison:{comparisonId}`               | `{ id, guestId, prompt }`      | the guest session's expiry  |
| `context:guest:{guestId}`                       | `{ summary, upToMessageId }`   | the guest session's expiry  |
| `context:guest:{guestId}:summary-lock`          | one summary at a time          | 60 s                        |
| `rate:{rule}:{hashedSubject}`                   | fixed-window counter           | the rule's window           |

Redis expiry is the only cleanup mechanism. Nothing about a guest is written to PostgreSQL.

## Quota

`apps/api/src/services/quota.service.ts`:

- Guests: `GUEST_DAILY_MESSAGE_LIMIT` per UTC day (default 20). Users: `USER_DAILY_MESSAGE_LIMIT` (default 200).
- `consume()` increments atomically; if the result is over the limit it decrements again and throws `QUOTA_EXCEEDED` (429, `Retry-After` until midnight UTC). A rejected call never uses up allowance.
- Clearing cookies creates a new guest with a fresh quota, so guests also count against a per-IP counter capped at 3× the guest limit.

Phase 1 exposes the quota through `/api/me`. Chat and comparison (Phases 2 and 4) call `consume()` before any provider work, as the integration test `apps/api/tests/integration/identity.test.ts` demonstrates.

## Migration after signup (Phase 2, MODEL-019)

1. Signup or login completes while `a_ai_guest` is present.
2. The migration service reads the guest's temporary conversation from Redis.
3. It writes it under the user in one PostgreSQL transaction, keyed by `(userId, guestId)` so a retry cannot duplicate it.
4. It deletes the guest keys and clears the guest cookie.
