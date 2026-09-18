-- Reorder the model registry so Gemini 3.5 Flash-Lite is listed first.
--
-- Registry rows are seeded from the code catalog once and never overwritten
-- (ModelRegistryRepository.insertMissing), so changing the catalog order only
-- reaches a fresh database. This applies the same order to existing ones.
--
-- The values match registryDefaults(): (index + 1) * 10 over catalogModels(),
-- which is PROVIDER_PREFERENCE (gemini, groq, openrouter) and, inside each
-- provider, MODEL_CATALOG order.
--
-- This overwrites sortOrder, including any an admin set on /models. It matches
-- what the code would seed today, and the order stays admin-editable afterwards.

UPDATE "model_registry" SET "sortOrder" = 10 WHERE "provider" = 'gemini'     AND "modelId" = 'gemini-3.5-flash-lite';
UPDATE "model_registry" SET "sortOrder" = 20 WHERE "provider" = 'gemini'     AND "modelId" = 'gemini-3.8-flash';
UPDATE "model_registry" SET "sortOrder" = 30 WHERE "provider" = 'groq'       AND "modelId" = 'openai/gpt-oss-120b';
UPDATE "model_registry" SET "sortOrder" = 40 WHERE "provider" = 'groq'       AND "modelId" = 'openai/gpt-oss-20b';
UPDATE "model_registry" SET "sortOrder" = 50 WHERE "provider" = 'openrouter' AND "modelId" = 'google/gemma-4-31b-it:free';
UPDATE "model_registry" SET "sortOrder" = 60 WHERE "provider" = 'openrouter' AND "modelId" = 'nvidia/nemotron-3-super-120b-a12b:free';
