# ADR-013: Retries, fallback and provider health

**Status:** Accepted (2026-09-15, Phase 6)

## Context

Blueprint §16 Phase 6: "provider health, retries, model/provider fallback, request cancellation", gated on "deterministic fallback rules with tests for timeout/429/provider failure". §14 adds that provider health is measured separately and one degraded provider must not make the API look dead. Free-tier providers rate-limit often, so without retries and fallback a chat fails whenever one provider has a bad minute.

ADR-011 already decided comparison never falls back: substituting a model would compare the wrong thing.

## Decisions

### 1. Chat retries the chosen model once, then falls back, and labels the answer

Chosen by the product owner on 2026-09-15. Rules live in one pure function, `decideAfterFailure` (`apps/api/src/ai/retry-policy.ts`):

| Failure before any text                          | Retry same model                          | Fall back | Counts against provider |
| ------------------------------------------------ | ----------------------------------------- | --------- | ----------------------- |
| `PROVIDER_TIMEOUT`                               | once, after 500 ms                        | yes       | yes                     |
| `RATE_LIMITED`, `Retry-After` ≤ 3 s or absent    | once, after `Retry-After` (1 s if absent) | yes       | yes                     |
| `RATE_LIMITED`, `Retry-After` > 3 s              | no                                        | yes       | yes                     |
| `MODEL_UNAVAILABLE`, retryable (5xx, network)    | once, after 500 ms                        | yes       | yes                     |
| `MODEL_UNAVAILABLE`, not retryable (401/403/404) | no                                        | yes       | yes                     |
| `PROVIDER_BAD_RESPONSE`                          | no                                        | yes       | yes                     |
| Anything else (unexpected error, cancellation)   | no                                        | no        | no                      |

- **After any text has streamed, nothing is retried and nothing falls back.** The user has already seen part of that model's answer; the Phase 2 outcome table (ADR-009) applies unchanged.
- The chosen model gets at most 2 attempts; each fallback model gets 1; at most 2 fallback models. A request therefore makes at most 4 provider calls.
- One chat message uses one message of allowance however many attempts it takes, and it is refunded if every attempt fails before any text.
- `CHAT_FALLBACK_ENABLED=false` keeps the retry but never switches models.

### 2. Fallback order is deterministic

`fallbackCandidates` (`apps/api/src/ai/model-router.ts`):

1. Only available models (enabled, provider configured) of the same category.
2. Never the failed model; never a provider whose circuit is open.
3. Other providers first, since a timeout, 429 or outage usually affects the whole provider; then the failed provider's other models.
4. Registry order inside each group: the order admins set on `/models`.

Each candidate's context is planned again with its own window and calibrated ratio (ADR-012); a candidate the conversation cannot fit is skipped.

### 3. The client is told, and the run remembers

- `message.retry { attempt, delayMs, code }` before a retry: the UI shows "Retrying…".
- `message.fallback { from, to, code, reason }` before another model answers: everything after it comes from `to`. The reply is labelled "Answered by _to_ because _from_ was unavailable".
- `model_runs` keeps the answering `provider`/`model` and adds `requested_provider`, `requested_model`, `attempt_count` and `fallback_reason`; `ChatMessageRun.fallbackFrom` exposes it in history. Cost is estimated with the model that answered.

### 4. Provider health is a circuit breaker in Redis

`ProviderHealthService` (`apps/api/src/providers/provider-health.service.ts`), key `health:provider:{id}`, shared by every API instance:

- A provider fault increments `consecutiveFailures`; any success resets it.
- 3 consecutive failures open the circuit for 30 s. A 429 with `Retry-After` opens it for that long (at most 60 s).
- After the cooldown the next call is a probe: success closes the circuit, one more failure reopens it.
- Open circuit: the provider is skipped as a fallback, and a chat whose chosen model's provider is open goes straight to a fallback **if one exists**; if none does, the chosen model is tried anyway rather than failing without a call.
- Comparison runs record successes and failures too (they never retry or fall back), so all traffic informs health.
- Status: `healthy`, `degraded` (failures below the threshold), `down` (open, with `retryAt`), `not_configured`. Public at `GET /api/providers/health` and shown on `/models`.
- `/ready` is unchanged: a degraded or down provider never fails readiness (§14).
- Updates are read-modify-write. Two instances failing at the same instant can undercount by one, which only delays opening the circuit by one failure. Successes are written at most once a minute while the provider stays healthy, to keep Redis commands low.

### 5. Cancellation

Closing the stream (Stop, navigation, disconnect) aborts the request signal. The signal reaches the provider call, the retry backoff (`sleep` rejects immediately) and the fallback loop, so no further attempt starts. The run is `CANCELLED` with the usual refund rules. No separate cancel endpoint is needed: the stream is bound to one instance.

## Consequences

- A chat can be answered by a model the user did not pick; the label, the `fallbackFrom` field and the kill switch keep that visible and controllable.
- Worst-case time to an error grows to four provider attempts plus short backoffs, still bounded by each adapter's connect and idle timeouts.
- Per-provider concurrency caps (§13) are not implemented here; the circuit breaker and daily allowance limit runaway spend. Revisit in Phase 10 hardening.
