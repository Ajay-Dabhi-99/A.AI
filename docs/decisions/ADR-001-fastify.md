# ADR-001: Fastify for the API gateway

**Status:** Accepted (blueprint §3, Appendix B)

## Context

The API validates input, resolves identity, enforces quotas, orchestrates parallel provider calls and streams SSE. Express and Fastify both fit.

## Decision

Fastify 5 with TypeScript.

## Consequences

- Encapsulated plugin model and hooks give one place for request IDs, logging and error normalization (`apps/api/src/plugins`).
- `inject()` lets integration tests exercise the full request pipeline without opening a port.
- Fastify's speed is not why it was chosen: upstream model latency dominates request time.
- Fastify 5.12 deprecated top-level `requestIdLogLabel` / `disableRequestLogging`; A.ai uses the `LogController` option instead.
