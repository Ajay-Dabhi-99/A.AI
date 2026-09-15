# A.ai

A multi-model AI workspace: chat with one model, or send the same prompt to several models in parallel and compare their answers with latency, token usage and cost side by side.

> **Status:** all phases (0–10) are implemented: auth and guest mode, streaming chat, model registry, multi-model comparison, context management, fallback routing, history and analytics, image input, voice input and read-aloud, and release tooling. Production launch steps are in [docs/development/deployment.md](docs/development/deployment.md); progress is tracked in [docs/development/roadmap.md](docs/development/roadmap.md).

## Stack

| Layer           | Choice                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| Web             | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, Zustand, Motion |
| API             | Fastify 5, TypeScript, Zod                                                   |
| Database        | Supabase PostgreSQL via Prisma 7 (pg driver adapter)                         |
| Temporary state | Upstash Redis (guest sessions, quotas, rate limits), mandatory               |
| AI providers    | OpenRouter, Gemini, Groq behind one provider interface                       |
| Monorepo        | pnpm workspaces + Turborepo                                                  |
| CI              | GitHub Actions                                                               |

Docker is not used. Source of truth: [the master blueprint](docs/blueprint/ModelArena_Master_Implementation_Blueprint_v4.docx).

## Prerequisites

- Node.js **22.13 or newer** (`node -v`)
- pnpm **10** (`npm install -g pnpm@10`)
- A [Supabase](https://supabase.com) project (PostgreSQL)
- An [Upstash](https://upstash.com) Redis database
- At least one AI provider key (OpenRouter, Gemini or Groq)

## Setup

```bash
pnpm install
```

Copy `.env.example` to `.env` in the repository root and fill it in. The file documents where each value comes from.

```bash
pnpm check:env
```

```bash
pnpm dev
```

- Web: http://localhost:5180
- API: http://localhost:4000 (`/health`, `/ready`)

Ports 4000/5180 avoid clashing with other local projects on 3000/5000/5173.

## Scripts

| Command                    | What it does                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                 | API (watch mode) and web dev server together                                 |
| `pnpm verify`              | Format check, lint, typecheck, unit + integration tests, build               |
| `pnpm test:unit`           | Fast unit tests across every workspace                                       |
| `pnpm test:integration`    | Fastify routes end-to-end with controlled DB/Redis adapters                  |
| `pnpm test:live`           | Real Supabase + Upstash checks (needs `TEST_DATABASE_URL`, `TEST_REDIS_URL`) |
| `pnpm check:env`           | Validates `.env` without printing any values                                 |
| `pnpm db:migrate`          | Create and apply a Prisma migration (development)                            |
| `pnpm db:deploy`           | Apply pending migrations (CI / production)                                   |
| `pnpm db:seed`             | Insert default models into the registry (never overwrites edits)             |
| `pnpm admin:promote`       | `pnpm admin:promote <email> [--revoke]`: grant or remove the admin role      |
| `pnpm attachments:cleanup` | Remove image uploads never sent within 24 hours (schedule daily)             |
| `pnpm test:e2e`            | Playwright browser smoke with a mocked API (needs Chromium)                  |
| `pnpm smoke`               | `pnpm smoke --api <url> [--web <origin>]`: check a deployed release          |

## Repository layout

```
apps/web            React app (presentation, client state, data fetching)
apps/api            Fastify API gateway (identity, quotas, orchestration)
packages/shared-types   Canonical API, AI, error and health types
packages/ai-core        Provider interface, registry, provider error type
packages/ai-providers   HTTP/SSE plumbing and provider adapters
packages/validation     Browser-safe Zod schemas
packages/config         Typed env contracts + shared tsconfig
prisma/             Schema, migrations, seed
scripts/            Operational scripts
docs/               Architecture, API, phases, decisions, learning guide
```

## Documentation

- [Learning guide: what each phase builds and where](docs/development/learning-guide.md)
- [Roadmap and tracker](docs/development/roadmap.md)
- [Deployment, backups and rollback](docs/development/deployment.md)
- [System architecture](docs/architecture/system-architecture.md)
- [Repository architecture](docs/architecture/repository-architecture.md)
- [API reference](docs/api/health.md)
- [Architecture decisions](docs/decisions/)
- [Blueprint review and suggestions](docs/development/blueprint-review.md)

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE).
