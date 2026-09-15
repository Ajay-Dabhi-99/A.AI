# A.ai

[![CI](https://github.com/Ajay-Dabhi-99/A.AI/actions/workflows/ci.yml/badge.svg)](https://github.com/Ajay-Dabhi-99/A.AI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 22.13+](https://img.shields.io/badge/node-22.13%2B-339933)
![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220)

**Put AI models in the ring.** A.ai is a multi-model AI workspace: chat with one model, or send the same prompt to several models at once and compare their answers side by side, with latency, token usage and estimated cost for each.

## Features

- **Side-by-side comparison:** run one prompt across up to 4 models in parallel. A model that fails or hits a rate limit shows its own error; the others keep streaming.
- **Streaming chat:** token-by-token answers, saved conversations for signed-in users, and automatic retry and fallback to a healthy model (clearly labelled).
- **Metrics on every run:** time to first token, total latency, input/output tokens, context use and estimated cost.
- **Guest mode:** try it without an account under a server-enforced daily limit; guest chats move into the account after signup.
- **Accounts:** email and password with email verification, password reset and revocable sessions.
- **History and dashboard:** search and filter past chats and comparisons, reopen run details, and see usage over time.
- **Model registry:** one catalog of models, capabilities and prices; admins can enable or disable models.
- **Context management:** conversations stay within each model's context budget, with background summaries for long chats.
- **Multimodal:** image upload for vision models, voice input (speech-to-text with Groq) and read-aloud. Image and video generation use resumable background jobs; no generation provider is enabled yet, and the app says so.
- **Provider-agnostic:** OpenRouter, Google Gemini and Groq behind one provider interface.

## Stack

| Layer           | Choice                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| Web             | React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, Zustand, Motion |
| API             | Fastify 5, TypeScript, Zod                                                   |
| Database        | Supabase PostgreSQL via Prisma 7 (pg driver adapter), Row Level Security on  |
| Temporary state | Upstash Redis (guest sessions, quotas, rate limits), mandatory               |
| File storage    | Supabase Storage (private bucket, signed URLs)                               |
| Email           | Resend                                                                       |
| AI providers    | OpenRouter, Gemini, Groq behind one provider interface                       |
| Monorepo        | pnpm workspaces + Turborepo                                                  |
| CI / hosting    | GitHub Actions; Vercel (web) and Render (API)                                |

Docker is not used.

## Project status

All phases (0–10) are **code complete**: `pnpm verify` passes (format, lint, typecheck, unit and integration tests, build). Verification against real infrastructure and the first production deploy are still in progress; see the [roadmap](docs/development/roadmap.md) for the phase-by-phase status and test evidence.

## Getting started

### Prerequisites

- Node.js **22.13 or newer** (`node -v`)
- pnpm **10** (`npm install -g pnpm@10`)
- A [Supabase](https://supabase.com) project (PostgreSQL)
- An [Upstash](https://upstash.com) Redis database
- At least one AI provider key: [OpenRouter](https://openrouter.ai), [Gemini](https://aistudio.google.com) or [Groq](https://console.groq.com)
- Optional: a [Resend](https://resend.com) API key to send verification emails (without it, emails are printed in the API log)

### Setup

```bash
git clone https://github.com/Ajay-Dabhi-99/A.AI.git
```

```bash
cd A.AI
```

```bash
pnpm install
```

Copy `.env.example` to `.env` in the repository root and fill it in. The file documents where each value comes from. Then check it (values are never printed):

```bash
pnpm check:env
```

Apply the database migrations and seed the model registry:

```bash
pnpm db:deploy
```

```bash
pnpm db:seed
```

Start the API and web app:

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
| `pnpm test:e2e`            | Playwright browser smoke with a mocked API (needs Chromium)                  |
| `pnpm check:env`           | Validates `.env` without printing any values                                 |
| `pnpm db:migrate`          | Create and apply a Prisma migration (development)                            |
| `pnpm db:deploy`           | Apply pending migrations (CI / production)                                   |
| `pnpm db:seed`             | Insert default models into the registry (never overwrites edits)             |
| `pnpm admin:promote`       | `pnpm admin:promote <email> [--revoke]`: grant or remove the admin role      |
| `pnpm attachments:cleanup` | Remove image uploads never sent within 24 hours (schedule daily)             |
| `pnpm smoke`               | `pnpm smoke --api <url> [--web <origin>]`: check a deployed release          |

## Repository layout

```
apps/web                React app (presentation, client state, data fetching)
apps/api                Fastify API gateway (identity, quotas, orchestration)
packages/shared-types   Canonical API, AI, error and health types
packages/ai-core        Provider interface, registry, provider error type
packages/ai-providers   HTTP/SSE plumbing and provider adapters
packages/validation     Browser-safe Zod schemas
packages/config         Typed env contracts + shared tsconfig
prisma/                 Schema, migrations, seed
scripts/                Operational scripts
docs/                   Architecture, API, phases, decisions, learning guide
```

## Documentation

- [Learning guide: what each phase builds and where](docs/development/learning-guide.md)
- [Roadmap and tracker](docs/development/roadmap.md)
- [Deployment, backups and rollback](docs/development/deployment.md)
- [Release checklist](docs/development/release-checklist.md)
- [Security review](docs/development/security-review.md)
- [System architecture](docs/architecture/system-architecture.md)
- [Repository architecture](docs/architecture/repository-architecture.md)
- [API reference](docs/api/)
- [Architecture decisions](docs/decisions/)
- [Blueprint review and suggestions](docs/development/blueprint-review.md)

The original implementation blueprint is in [docs/blueprint](docs/blueprint/) (written under the working name ModelArena; the product is A.ai, see [ADR-007](docs/decisions/ADR-007-product-name.md)).

## Contributing

Work is tracked as `MODEL-XXX` tasks. Open an issue from the **Implementation task** or **Defect** template, branch per task, and use [Conventional Commits](https://www.conventionalcommits.org) (for example `feat(chat): add regenerate`). Pull requests follow the [PR template](.github/pull_request_template.md) and must pass `pnpm verify`.

## License

[MIT](LICENSE) © 2026 Dabhi Ajay
