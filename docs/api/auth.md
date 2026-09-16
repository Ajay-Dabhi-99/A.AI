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

| Method | Path                            | Body                                       | Success                                           | Errors                                                     |
| ------ | ------------------------------- | ------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/me`                       | none                                       | `200 MeResponse`, issues a guest cookie if needed | `429`                                                      |
| PATCH  | `/api/me/profile`               | `{ firstName, lastName, phone }`           | `200 { user }`                                    | `400 VALIDATION_ERROR`, `401 AUTH_REQUIRED`, `429`         |
| POST   | `/api/auth/signup`              | `{ firstName, lastName, email, password }` | `202 { status: "accepted" }`                      | `400 VALIDATION_ERROR`, `429`                              |
| POST   | `/api/auth/verify-email`        | `{ token }`                                | `200 { user }` + session cookie                   | `400 TOKEN_INVALID`, `429`                                 |
| POST   | `/api/auth/resend-verification` | `{ email }`                                | `202 { status: "accepted" }`                      | `400`, `429`                                               |
| POST   | `/api/auth/login`               | `{ email, password }`                      | `200 { user }` + session cookie                   | `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED`, `429` |
| POST   | `/api/auth/logout`              | none                                       | `204`, clears the session cookie                  | none                                                       |
| POST   | `/api/auth/logout-all`          | none                                       | `204`, revokes every session                      | `401 AUTH_REQUIRED`                                        |
| POST   | `/api/auth/forgot-password`     | `{ email }`                                | `202 { status: "accepted" }`                      | `400`, `429`                                               |
| POST   | `/api/auth/reset-password`      | `{ token, password }`                      | `200 { user }` + new session cookie               | `400 TOKEN_INVALID`, `429`                                 |

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
      "firstName": "Ada",
      "lastName": "Lovelace",
      "phone": "+91 98765 43210",
      "role": "user",
      "createdAt": "2026-09-13T10:00:00.000Z"
    }
  },
  "quota": { "limit": 200, "used": 3, "remaining": 197, "resetsAt": "2026-09-14T00:00:00.000Z" },
  "limits": { "compareMaxModels": 4 }
}
```

A guest gets `"identity": { "kind": "guest", "expiresAt": "…" }`, the guest quota and the guest limits. The guest id itself is never returned.

`limits.compareMaxModels` (Phase 4) is how many models one [comparison](comparison.md) may run: `GUEST_COMPARE_MAX_MODELS` (default 2) or `USER_COMPARE_MAX_MODELS` (default 4). The API enforces it; the web app uses it to lock the model picker.

`role` is `user` or `admin` (Phase 3). It only decides which controls the web app shows; admin routes check the role on the server. See [making the first admin](models.md#making-the-first-admin).

## Field rules

| Field                            | Rule                                                          |
| -------------------------------- | ------------------------------------------------------------- |
| `email`                          | Trimmed and lowercased; valid address; at most 254 characters |
| `firstName`, `lastName` (signup) | Required; same rules as the [profile](#profile) names         |
| `password` (signup, reset)       | 10–128 characters; not equal to the email                     |
| `password` (login)               | 1–128 characters                                              |
| `token`                          | base64url, 32–128 characters                                  |

Validation failures return `details: [{ path, message }]`, which the web forms show on the matching field.

## Emailed links

| Email                       | Link                                           | Expires              |
| --------------------------- | ---------------------------------------------- | -------------------- |
| Verify your email           | `{APP_URL}/verify-email#token=…`               | 24 hours, single use |
| Reset your password         | `{APP_URL}/reset-password#token=…`             | 1 hour, single use   |
| You already have an account | `{APP_URL}/login`, `{APP_URL}/forgot-password` | n/a                  |
| Your password was changed   | `{APP_URL}/forgot-password`                    | n/a                  |

Without `RESEND_API_KEY` (development only), these emails are printed in the API log instead of sent.

## Profile

`PATCH /api/me/profile` replaces every profile field of the signed-in account (MODEL-060). `firstName` and `lastName` are required (signup requires them too, so they cannot be cleared later). `phone` is optional; sent blank, `null` or missing, it is cleared.

A repeated signup for an email that is not verified yet replaces the stored name and password (the latest signup wins). Accounts created before names were required keep `null` names until they save their profile.

| Field                   | Rules                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `firstName`, `lastName` | Required. Trimmed, 1–60 characters, letters (any script), spaces, hyphens, apostrophes |
| `phone`                 | Trimmed, at most 24 characters, digits with optional `+ ( ) -`, at least 7 digits      |

The rules live in `packages/validation/src/auth.ts` and the web form reuses them, so both sides agree. The phone number is never used for authentication or messaging.

## Rate limits

See [ADR-008](../decisions/ADR-008-authentication.md#rate-limits-upstash-fixed-window). A limited request returns `429 RATE_LIMITED` with `Retry-After`.
