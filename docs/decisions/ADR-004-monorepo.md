# ADR-004: pnpm + Turborepo monorepo with source-first package resolution

**Status:** Accepted (blueprint §21.1)

## Decision

- pnpm 10 workspaces (`pnpm-workspace.yaml`) and Turborepo 2 (`turbo.json`).
- Internal packages export a custom `@a-ai/source` condition pointing at `src/*.ts`, plus `types`/`default` pointing at `dist`.
- Development, tests and typechecking use the source condition; production builds resolve `dist`, built in dependency order by Turborepo.
- One root `.env` for API, Prisma and Vite. Validated contracts live in `packages/config`.
- Prisma schema at the repository root (`prisma/`), client generated into `apps/api/src/generated/prisma`.
- ESLint flat config and Prettier at the root.

## Why the source condition

Without it, every change in `packages/*` needs a rebuild before the apps see it, and stale `dist` output causes confusing type errors. With it, there is no watch process for packages, and builds still ship compiled JavaScript.

## Consequences

- pnpm 10 blocks dependency install scripts by default. `onlyBuiltDependencies` allow-lists Prisma and esbuild.
- Turborepo's strict env mode hides variables from tasks unless listed; test variables are in `globalPassThroughEnv`.
