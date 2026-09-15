# Platform API: health, readiness and errors

**Implemented in Phase 0.** Types: `packages/shared-types/src/health.ts`, `errors.ts`. Schemas: `packages/validation`.

## Common behavior (every route)

| Header         | Direction          | Meaning                                                                     |
| -------------- | ------------------ | --------------------------------------------------------------------------- |
| `x-request-id` | request (optional) | Reused when it is 8–128 characters of `[A-Za-z0-9._:-]`; otherwise replaced |
| `x-request-id` | response           | The ID in every log line for this request. Quote it in bug reports.         |
| `retry-after`  | response           | Seconds to wait, on rate-limit errors caused by a provider                  |

Body limit: 1 MB (413 above it). CORS: only origins in `CORS_ORIGIN`, with credentials.

## `GET /health`

Liveness. Never touches dependencies.

```json
200 OK
{ "status": "ok", "service": "a-ai-api", "version": "0.1.0", "commit": "914d0a5…", "uptimeSeconds": 42 }
```

`commit` is the deployed commit that Render provides as `RENDER_GIT_COMMIT`, or `null` when unknown (locally). The release smoke test waits for it to match the commit being deployed (Phase 10, [ADR-017](../decisions/ADR-017-production-hosting.md)).

## `GET /ready`

Readiness. Probes Supabase PostgreSQL and Upstash Redis in parallel (2 s timeout each) and checks that at least one AI provider key is configured.

```json
200 OK
{
  "status": "ready",
  "checks": {
    "database": { "status": "up", "latencyMs": 38 },
    "redis": { "status": "up", "latencyMs": 21 },
    "providers": { "status": "up", "configured": ["gemini", "groq"] }
  }
}
```

```json
503 Service Unavailable
{
  "status": "not_ready",
  "checks": {
    "database": { "status": "up", "latencyMs": 40 },
    "redis": { "status": "down", "latencyMs": 2001, "error": "timed out after 2000ms" },
    "providers": { "status": "up", "configured": ["groq"] }
  }
}
```

Both responses send `cache-control: no-store`.

## Error envelope

Every non-2xx response except `/ready`'s 503 report uses:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "retryable": false,
    "requestId": "3f0c2a4e-...",
    "details": [{ "path": "messages.0.content", "message": "must be string" }]
  }
}
```

| Code                    | HTTP        | Retryable | When                                               |
| ----------------------- | ----------- | --------- | -------------------------------------------------- |
| `AUTH_REQUIRED`         | 401         | no        | Protected action without login                     |
| `QUOTA_EXCEEDED`        | 429         | no        | Daily quota used up                                |
| `RATE_LIMITED`          | 429         | yes       | Too many requests (ours or the provider's)         |
| `MODEL_UNAVAILABLE`     | 503         | depends   | Provider down, unknown, or not configured          |
| `PROVIDER_TIMEOUT`      | 504         | yes       | Provider exceeded its timeout                      |
| `PROVIDER_BAD_RESPONSE` | 502         | no        | Provider returned something unusable               |
| `CONTEXT_TOO_LARGE`     | 422         | no        | Conversation cannot fit the model                  |
| `VALIDATION_ERROR`      | 400/413/415 | no        | Invalid input, malformed JSON, body too large      |
| `NOT_FOUND`             | 404         | no        | Unknown route or resource                          |
| `INTERNAL_ERROR`        | 500         | no        | Unexpected failure. The message is always generic. |

`NOT_FOUND` is an addition to the blueprint taxonomy ([ADR-005](../decisions/ADR-005-infrastructure.md)).
