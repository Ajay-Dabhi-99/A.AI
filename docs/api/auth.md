# Auth and identity API

**Implemented in Phase 1.** Types: `packages/shared-types/src/auth.ts`. Request and response schemas: `packages/validation/src/auth.ts`. Design: [ADR-008](../decisions/ADR-008-authentication.md).

All bodies are JSON. State-changing requests from a browser must come from an origin in `CORS_ORIGIN` (otherwise `403 FORBIDDEN`). Errors use the [standard envelope](health.md#error-envelope).

## Cookies

| Cookie (dev)   | Cookie (production)   | Holds                   | Lifetime                    |
| -------------- | --------------------- | ----------------------- | --------------------------- |
| `a_ai_session` | `__Host-a_ai_session` | Signed-in session token | 30 days, sliding            |
| `a_ai_guest`   | `__Host-a_ai_guest`   | Guest session id        | `GUEST_SESSION_TTL_MINUTES` |

Both are `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production.

## Endpoints

| Method | Path                            | Body                  | Success                                           | Errors                                                     |
| ------ | ------------------------------- | --------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/me`                       | none                  | `200 MeResponse`, issues a guest cookie if needed | `429`                                                      |
| POST   | `/api/auth/signup`              | `{ email, password }` | `202 { status: "accepted" }`                      | `400 VALIDATION_ERROR`, `429`                              |
| POST   | `/api/auth/verify-email`        | `{ token }`           | `200 { user }` + session cookie                   | `400 TOKEN_INVALID`, `429`                                 |
| POST   | `/api/auth/resend-verification` | `{ email }`           | `202 { status: "accepted" }`                      | `400`, `429`                                               |
| POST   | `/api/auth/login`               | `{ email, password }` | `200 { user }` + session cookie                   | `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED`, `429` |
| POST   | `/api/auth/logout`              | none                  | `204`, clears the session cookie                  | none                                                       |
| POST   | `/api/auth/logout-all`          | none                  | `204`, revokes every session                      | `401 AUTH_REQUIRED`                                        |
| POST   | `/api/auth/forgot-password`     | `{ email }`           | `202 { status: "accepted" }`                      | `400`, `429`                                               |
| POST   | `/api/auth/reset-password`      | `{ token, password }` | `200 { user }` + new session cookie               | `400 TOKEN_INVALID`, `429`                                 |

`202` responses are identical whether or not the email belongs to an account.

### `MeResponse`

```json
{
  "identity": {
    "kind": "user",
    "user": {
      "id": "0b9f…",
      "email": "person@example.com",
      "emailVerified": true,
      "createdAt": "2026-09-13T10:00:00.000Z"
    }
  },
  "quota": { "limit": 200, "used": 3, "remaining": 197, "resetsAt": "2026-09-14T00:00:00.000Z" }
}
```

A guest gets `"identity": { "kind": "guest", "expiresAt": "…" }` and the guest limit. The guest id itself is never returned.

## Field rules

| Field                      | Rule                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `email`                    | Trimmed and lowercased; valid address; at most 254 characters |
| `password` (signup, reset) | 10–128 characters; not equal to the email                     |
| `password` (login)         | 1–128 characters                                              |
| `token`                    | base64url, 32–128 characters                                  |

Validation failures return `details: [{ path, message }]`, which the web forms show on the matching field.

## Emailed links

| Email                       | Link                                           | Expires              |
| --------------------------- | ---------------------------------------------- | -------------------- |
| Verify your email           | `{APP_URL}/verify-email#token=…`               | 24 hours, single use |
| Reset your password         | `{APP_URL}/reset-password#token=…`             | 1 hour, single use   |
| You already have an account | `{APP_URL}/login`, `{APP_URL}/forgot-password` | n/a                  |
| Your password was changed   | `{APP_URL}/forgot-password`                    | n/a                  |

Without `RESEND_API_KEY` (development only), these emails are printed in the API log instead of sent.

## Rate limits

See [ADR-008](../decisions/ADR-008-authentication.md#rate-limits-upstash-fixed-window). A limited request returns `429 RATE_LIMITED` with `Retry-After`.
