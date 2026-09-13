# Models API

> **Planned. Phase 3 (MODEL-013).**

| Method | Path          | Access | Purpose                                                       |
| ------ | ------------- | ------ | ------------------------------------------------------------- |
| GET    | `/api/models` | Public | Enabled models with capabilities (`AIModel`) and availability |

The registry is data, not code: model IDs, context windows, pricing and free-tier limits change often. Store them in the `model_registry` table (seeded from `prisma/seed.ts`), version pricing, and hide models whose provider key is not configured.
