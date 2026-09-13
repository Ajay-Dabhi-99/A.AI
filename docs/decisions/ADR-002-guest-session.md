# ADR-002: Guest sessions in Upstash Redis with TTL

**Status:** Accepted

## Context

Blueprint v4 is internally inconsistent about where guest data lives:

- §2 and §8 say guest data is "backed by Supabase PostgreSQL" with "an expiration timestamp and scheduled cleanup".
- §25 says "no Docker or Upstash dependency is required".
- The closing **INFRASTRUCTURE DECISION — MVP** section, Appendix B and §13 say guest identity, usage counters, expiration and temporary conversation state are stored **in Upstash Redis with TTLs**, that "Redis expiration is the primary cleanup mechanism", and that Upstash is mandatory.

## Decision

Follow the INFRASTRUCTURE DECISION section: it is the most specific, the latest addition, and matches the document's file name ("Redis Upstash Mandatory"). Guest sessions, quotas, rate-limit counters and temporary conversations live in Upstash Redis with TTLs. Only conversations explicitly migrated after signup become PostgreSQL rows.

## Consequences

- No cleanup job is needed for guest data.
- A Redis outage makes the API not ready (`/ready` 503), which is the intended behavior for a mandatory dependency.
- The blueprint should be corrected in §2, §8 and §25 so the next reader is not misled.
- Design details: [guest mode](../architecture/guest-mode.md).
