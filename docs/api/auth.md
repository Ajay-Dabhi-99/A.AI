# Auth API

> **Planned. Phase 1 (MODEL-006, MODEL-007).** Contract from blueprint §9; finalize request/response schemas in `packages/validation` when implementing.

| Method | Path                 | Access        | Purpose                                                          |
| ------ | -------------------- | ------------- | ---------------------------------------------------------------- |
| POST   | `/api/auth/signup`   | Public        | Create account, start session, migrate guest data if present     |
| POST   | `/api/auth/login`    | Public        | Authenticate, start session                                      |
| POST   | `/api/auth/logout`   | User          | End session                                                      |
| GET    | `/api/me`            | Guest or user | Current identity and quota summary                               |
| POST   | `/api/guest/migrate` | User          | Idempotently move the active guest conversation into the account |

Decisions to confirm in Phase 1 (see [blueprint review](../development/blueprint-review.md)):

- Session format: revocable session ID in an HTTP-only cookie (recommended) versus stateless JWT.
- Password hashing: argon2id.
- Email verification and password reset flows (not in the blueprint).
- CSRF: `SameSite=Lax` cookies plus an `Origin` check on state-changing requests.
