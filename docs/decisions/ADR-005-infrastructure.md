# ADR-005: Supabase PostgreSQL + Upstash Redis, no Docker

**Status:** Accepted (blueprint v4 INFRASTRUCTURE DECISION)

## Decision

| Concern              | Choice                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| Durable data         | Supabase PostgreSQL through Prisma 7 and `@prisma/adapter-pg`           |
| Runtime connection   | `DATABASE_URL`: Supavisor pooled connection (port 6543)                 |
| Migrations           | `DIRECT_URL`: direct connection (port 5432), used by `prisma.config.ts` |
| Temporary state      | Upstash Redis over TLS (`rediss://`) with ioredis                       |
| Local infrastructure | None. Docker is not used.                                               |

## Testing strategy

| Suite                                 | Infrastructure                                                                                | Runs                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Unit (`pnpm test:unit`)               | none                                                                                          | every PR                                                                                    |
| Integration (`pnpm test:integration`) | Fastify `inject` with a controlled Prisma stub and `ioredis-mock` injected through `buildApp` | every PR                                                                                    |
| Live (`pnpm test:live`)               | real Supabase test project + real Upstash test database                                       | pushes to `develop`/`main`, before deploys, and locally before closing infrastructure tasks |

`ioredis-mock` is permitted by the blueprint ("controlled Redis test adapter"). It is only ever injected by tests; the application has no in-memory Redis mode and the env schema rejects anything but `redis://`/`rediss://` (production requires `rediss://`).

A missing `TEST_DATABASE_URL`/`TEST_REDIS_URL` **fails** the live suite. It never skips.

## Security consequences

- **Row Level Security.** Supabase exposes tables in the `public` schema through its Data API. Prisma-created tables are reachable with the project's anon key unless RLS is enabled. Every migration that creates a table must also `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (no policies, which denies Data API access; Prisma connects as the table owner and is unaffected).
- Readiness errors never include connection strings; probe failures log only error name/code.

## Other Phase 0 decisions recorded here

- Ports 4000 (API) and 5180 (web), so A.ai can run beside other local projects on 3000/5000/5173/5001.
- `NOT_FOUND` added to the error taxonomy: an unknown route is neither a validation error nor an internal error.
- `/ready` also requires at least one configured AI provider (blueprint v4 §14 "provider configuration"), so a deploy with no keys is visibly not ready.
