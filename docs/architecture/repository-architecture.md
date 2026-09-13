# Repository architecture

A pnpm + Turborepo monorepo (blueprint §21, [ADR-004](../decisions/ADR-004-monorepo.md)).

```
a-ai/
├── apps/
│   ├── web/                 React app
│   │   └── src/
│   │       ├── app/         router, providers, root layout
│   │       ├── pages/       route-level components
│   │       ├── components/  ui/ primitives, layout/ chrome
│   │       ├── features/    one folder per product feature (landing, chat, comparison, ...)
│   │       ├── hooks/       reusable hooks (use-api-status)
│   │       ├── services/    HTTP client functions (api.ts)
│   │       ├── stores/      Zustand stores (theme-store)
│   │       ├── lib/         utilities (cn, env, query client)
│   │       └── styles/      design tokens (globals.css)
│   └── api/
│       └── src/
│           ├── app.ts       composition root (buildApp)
│           ├── server.ts    process entry: env, listen, graceful shutdown
│           ├── plugins/     observability, cors, prisma, redis
│           ├── modules/     one folder per route family (health, auth, chat, ...)
│           ├── shared/      errors, constants
│           └── generated/   Prisma client (git-ignored)
├── packages/
│   ├── shared-types/        canonical types, no runtime dependencies
│   ├── ai-core/             provider interface, registry, AIProviderError
│   ├── ai-providers/        providerFetch, SSE parser, adapters (Phase 2+)
│   ├── validation/          Zod schemas safe for the browser
│   └── config/              env contracts (server/web) + tsconfig presets
├── prisma/                  schema.prisma, migrations/, seed.ts
├── scripts/                 check-env.ts
├── docs/                    architecture, api, development, decisions, blueprint
└── .github/                 workflows, issue templates, PR template
```

Folders listed in the blueprint's target tree (`ai/`, `repositories/`, `middleware/`, `schemas/`, `features/chat`, ...) are created by the phase that first needs them (blueprint §23: "intermediate phases may create only the folders required").

## Dependency rules

| Package        | May depend on                              | Must not                                          |
| -------------- | ------------------------------------------ | ------------------------------------------------- |
| `shared-types` | nothing                                    | contain runtime logic beyond constants            |
| `validation`   | `shared-types`, `zod`                      | import Node APIs (it ships to browsers)           |
| `config`       | `zod`                                      | expose server secrets through `./web`             |
| `ai-core`      | `shared-types`                             | import any provider SDK or HTTP client            |
| `ai-providers` | `ai-core`, `shared-types`                  | know about users, quotas or routes                |
| `apps/api`     | all packages                               | put provider HTTP code in routes                  |
| `apps/web`     | `shared-types`, `validation`, `config/web` | import `ai-core`, `ai-providers`, `config/server` |

The web boundary is enforced by ESLint `no-restricted-imports` in `eslint.config.js`.

## How packages resolve (source vs dist)

Each package's `package.json` exports three conditions:

```json
".": {
  "@a-ai/source": "./src/index.ts",
  "types": "./dist/index.d.ts",
  "default": "./dist/index.js"
}
```

- **Development, tests and typecheck** use the custom `@a-ai/source` condition, so edits in a package are visible immediately with no build step: tsc through `customConditions`, Vite/Vitest through `resolve.conditions`, the API dev server through `tsx --conditions`.
- **Builds** (`tsconfig.build.json` sets `customConditions: []`) resolve `dist`. Turborepo builds dependencies first (`dependsOn: ["^build"]`), and `node apps/api/dist/server.js` runs against compiled packages.

## Environment

One root `.env` serves the API, Prisma and the Vite dev server. Only `VITE_`-prefixed variables reach the browser bundle. Contracts:

- Server: `packages/config/src/server.ts` (validated at boot; invalid config exits with a list of problems and no values).
- Web: `packages/config/src/web.ts` (validated when the app loads).

## Git flow (blueprint §21.5–21.7)

- `main`: release-ready only, protected, no direct pushes.
- `develop`: integration branch for completed phase work.
- `feature/p<phase>-<scope>-MODEL-XXX`: one bounded task per branch, merged by PR with green CI.
- Conventional Commits: `feat(chat): add normalized SSE streaming`.
