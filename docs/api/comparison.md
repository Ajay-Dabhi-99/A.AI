# Comparison API

> **Planned. Phase 4 (MODEL-014).** Design: [comparison engine](../architecture/comparison-engine.md).

| Method | Path           | Access        | Purpose                                                                  |
| ------ | -------------- | ------------- | ------------------------------------------------------------------------ |
| POST   | `/api/compare` | Guest or user | Run one prompt across 2–4 models; stream all runs multiplexed by `runId` |
| GET    | `/api/usage`   | Guest or user | Usage and remaining quota                                                |
