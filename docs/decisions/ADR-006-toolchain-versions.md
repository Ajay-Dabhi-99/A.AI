# ADR-006: Toolchain version pins

**Status:** Accepted (2026-09-13)

Exact versions are pinned in every `package.json`. Where the newest release was not used, this is why:

| Package                 | Pinned  | Newest seen                | Reason                                      |
| ----------------------- | ------- | -------------------------- | ------------------------------------------- |
| TypeScript              | 6.0.3   | 7.0.2                      | typescript-eslint 8.70 supports `<6.1` only |
| Prisma / @prisma/client | 7.10.0  | 8.0.0-rc.14 (`latest` tag) | 8.0 is a release candidate                  |
| react-router            | 7.18.3  | 8.3.1                      | 8.x requires Node ≥ 22.22                   |
| jsdom                   | 29.1.1  | 30.0.1                     | 30.x requires Node ≥ 22.22                  |
| ioredis                 | 5.11.1  | 6.0.0                      | ioredis-mock 8 requires ioredis 5           |
| pnpm                    | 10.34.5 | 12.4.1                     | 10 is the stable line used by CI            |

Node floor: **22.13** (Vite 8, Vitest 5 and jsdom 29 minimums). CI uses the latest Node 22.

Revisit when typescript-eslint supports TypeScript 7, Prisma 8 is stable, and the local Node is upgraded to ≥ 22.22.
