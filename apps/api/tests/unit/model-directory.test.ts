import { DEFAULT_MODEL } from '@a-ai/ai-providers';
import { describe, expect, it } from 'vitest';
import { catalogModels, registryDefaults } from '../../src/providers/model-directory.js';

describe('model directory', () => {
  /**
   * Registry rows are seeded once and never overwritten, so an existing database
   * is reordered by prisma/migrations/20260918090000_model_order_flash_lite_first
   * instead. A fresh database is seeded from here, and the two must agree or the
   * picker would show a different order depending on when the database was made.
   */
  it('seeds the registry in the order the reorder migration writes', () => {
    expect(
      registryDefaults(catalogModels()).map((row) => [row.sortOrder, row.provider, row.modelId]),
    ).toEqual([
      [10, 'gemini', 'gemini-3.5-flash-lite'],
      [20, 'gemini', 'gemini-3.8-flash'],
      [30, 'groq', 'openai/gpt-oss-120b'],
      [40, 'groq', 'openai/gpt-oss-20b'],
      [50, 'openrouter', 'google/gemma-4-31b-it:free'],
      [60, 'openrouter', 'nvidia/nemotron-3-super-120b-a12b:free'],
    ]);
  });

  it('lists the default model first, so the picker opens on it', () => {
    const [first] = catalogModels();
    expect([first?.provider, first?.id]).toEqual([DEFAULT_MODEL.provider, DEFAULT_MODEL.id]);
  });
});
