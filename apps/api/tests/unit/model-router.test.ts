import { describe, expect, it } from 'vitest';
import { fallbackCandidates } from '../../src/ai/model-router.js';
import { testModel } from '../helpers/scripted-provider.js';

const groq120 = testModel('groq', 'gpt-oss-120b');
const groq20 = testModel('groq', 'gpt-oss-20b');
const gemini = testModel('gemini', 'gemini-flash');
const openrouter = testModel('openrouter', 'gemma-free');
const imageModel = testModel('gemini', 'imagen', { category: 'image' });
/** Registry order, as returned by ModelRegistryService.available(). */
const available = [groq120, groq20, gemini, imageModel, openrouter];

const ids = (models: { provider: string; id: string }[]) =>
  models.map((model) => `${model.provider}/${model.id}`);

describe('fallbackCandidates', () => {
  it('tries other providers first, then the failed provider, each in registry order', () => {
    expect(ids(fallbackCandidates(groq120, available, () => false))).toEqual([
      'gemini/gemini-flash',
      'openrouter/gemma-free',
      'groq/gpt-oss-20b',
    ]);
  });

  it('never offers the failed model, another category or a provider that is down', () => {
    const candidates = fallbackCandidates(
      gemini,
      available,
      (provider) => provider === 'openrouter',
    );
    expect(ids(candidates)).toEqual(['groq/gpt-oss-120b', 'groq/gpt-oss-20b']);
  });

  it('returns nothing when no other model can answer', () => {
    expect(fallbackCandidates(groq120, [groq120], () => false)).toEqual([]);
    expect(fallbackCandidates(groq120, available, () => true)).toEqual([]);
  });

  it('is deterministic for the same inputs', () => {
    const once = ids(fallbackCandidates(openrouter, available, () => false));
    expect(ids(fallbackCandidates(openrouter, available, () => false))).toEqual(once);
  });
});
