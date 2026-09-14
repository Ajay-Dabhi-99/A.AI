# Models API

**Phase 2: static catalog. Phase 3 (MODEL-013): database-backed registry.**

## `GET /api/models`

```json
{
  "models": [
    {
      "id": "openai/gpt-oss-120b",
      "provider": "groq",
      "name": "GPT-OSS 120B",
      "category": "text",
      "contextWindow": 131072,
      "maxOutputTokens": 65536,
      "supportsStreaming": true,
      "supportsVision": false,
      "supportsTools": true,
      "availability": "free-tier"
    }
  ],
  "defaultModel": { "provider": "groq", "id": "openai/gpt-oss-120b" }
}
```

- Only providers whose API key is configured are listed. With no keys, `models` is empty and `defaultModel` is `null`.
- Default preference: Groq, then Gemini, then OpenRouter.
- Cached privately by the browser for 60 seconds.

## Phase 2 catalog

Source: `packages/ai-providers/src/catalog.ts`, checked on 2026-09-13 ([ADR-009](../decisions/ADR-009-chat-providers.md#3-a-dated-static-model-catalog)).

| Provider   | Model id                                 | Context                | Notes                   |
| ---------- | ---------------------------------------- | ---------------------- | ----------------------- |
| Groq       | `openai/gpt-oss-120b`                    | 131,072                |                         |
| Groq       | `openai/gpt-oss-20b`                     | 131,072                |                         |
| OpenRouter | `google/gemma-4-31b-it:free`             | 262,144                | Free variant            |
| OpenRouter | `nvidia/nemotron-3-super-120b-a12b:free` | 262,144                | Free variant            |
| Gemini     | `gemini-3.8-flash`                       | 1,048,576 (unverified) | Confirm with a real key |
| Gemini     | `gemini-3.5-flash-lite`                  | 1,048,576 (unverified) | Confirm with a real key |

## Phase 3 plan

Move the catalog into a `model_registry` table seeded from `prisma/seed.ts`, versioned pricing, per-model free-tier limits, and an admin way to disable a model without a deploy.
