# Guest mode

> **Design. Implemented in Phase 1 (MODEL-007).** Nothing on this page exists in code yet.

Blueprint §2, §8, §13 and the v4 infrastructure decision; [ADR-002](../decisions/ADR-002-guest-session.md).

## Goals

- Anyone can try A.ai without an account.
- Limits are enforced on the server, never trusted from the browser.
- Guest data is temporary and expires on its own.
- A guest who signs up can keep their current conversation.

## Identity

- On the first API call without a session, the API issues `ma_guest`: a random 256-bit identifier in an HTTP-only, `Secure`, `SameSite=Lax` cookie, signed with `JWT_SECRET`.
- The identity resolver produces either `{ kind: 'user', userId }` or `{ kind: 'guest', sessionId }` for every request.

## Redis keys (Upstash, all with TTL)

| Key                                    | Value                                             | TTL                         |
| -------------------------------------- | ------------------------------------------------- | --------------------------- |
| `guest:session:{sessionId}`            | created-at, hashed IP, user agent family          | `GUEST_SESSION_TTL_MINUTES` |
| `guest:usage:{sessionId}:{yyyy-mm-dd}` | message counter (INCR)                            | until end of day + 1h       |
| `guest:conv:{sessionId}`               | temporary conversation (bounded list of messages) | session TTL                 |
| `rate:{scope}:{key}:{window}`          | sliding/fixed window counter                      | window length               |

Redis expiry is the cleanup mechanism: no cron job is needed for guest data.

## Quota sequence (blueprint §13)

1. Resolve identity.
2. Check the daily quota (`GUEST_DAILY_MESSAGE_LIMIT`), atomically increment-and-compare in one Lua script.
3. Check the request rate.
4. Validate the model is allowed for guests.
5. Call the provider.
6. On a provider failure that produced no output, refund the reservation.

Exceeded: `QUOTA_EXCEEDED` (429, not retryable until reset).

## Migration after signup

1. Signup/login completes while `ma_guest` is present.
2. The migration service reads `guest:conv:{sessionId}`.
3. It writes the conversation and messages under the user in one PostgreSQL transaction, keyed by `(userId, guestSessionId)` so a retry cannot duplicate them.
4. It deletes the guest keys and clears the cookie.

## Abuse considerations

- Clearing cookies resets a guest quota. A secondary per-IP limit (hashed IP) caps this.
- Consider Cloudflare Turnstile before issuing a guest session if abuse appears.
