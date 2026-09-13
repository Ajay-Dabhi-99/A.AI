# ADR-003: Provider abstraction split across ai-core and ai-providers

**Status:** Accepted (blueprint §7, §21.4)

## Context

The blueprint names both `packages/ai-providers` (adapters) and `apps/api/src/providers` (with `provider.interface.ts`). Keeping the interface in two places would let them drift.

## Decision

- `packages/ai-core`: the single definition of `AIProvider`, request/response/stream types, `AIProviderError` and `ProviderRegistry`. No HTTP, no SDKs.
- `packages/ai-providers`: shared plumbing (`providerFetch`, `parseSseStream`, status classification) and, from Phase 2, one folder per adapter.
- `apps/api/src/providers` (Phase 2): wiring only, meaning which adapters to register for the configured keys.
- Adapters call providers over HTTP with `fetch` rather than vendor SDKs where the REST API is stable, keeping timeout, cancellation and error mapping uniform.

## Consequences

- One failure policy for every provider, unit-tested once (`packages/ai-providers/tests/http.test.ts`).
- The web app cannot import provider code (ESLint rule).
