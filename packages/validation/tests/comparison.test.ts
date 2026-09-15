import { describe, expect, it } from 'vitest';
import {
  comparisonRequestSchema,
  comparisonRunRequestSchema,
  parseComparisonStreamEvent,
} from '../src/index.js';

const groq = { provider: 'groq', model: 'openai/gpt-oss-20b' };
const gemini = { provider: 'gemini', model: 'gemini-3.8-flash' };
const openrouter = { provider: 'openrouter', model: 'meta/llama' };

describe('comparisonRequestSchema', () => {
  it('accepts 2 to 4 distinct models and trims the prompt', () => {
    const parsed = comparisonRequestSchema.parse({ prompt: '  compare  ', models: [groq, gemini] });
    expect(parsed.prompt).toBe('compare');
    expect(
      comparisonRequestSchema.safeParse({
        prompt: 'hi',
        models: [groq, gemini, openrouter, { provider: 'groq', model: 'other' }],
      }).success,
    ).toBe(true);
  });

  it('rejects fewer than 2 or more than 4 models, and duplicates', () => {
    expect(comparisonRequestSchema.safeParse({ prompt: 'hi', models: [groq] }).success).toBe(false);
    expect(
      comparisonRequestSchema.safeParse({
        prompt: 'hi',
        models: [
          groq,
          gemini,
          openrouter,
          { provider: 'groq', model: 'b' },
          { provider: 'x', model: 'y' },
        ],
      }).success,
    ).toBe(false);
    const duplicate = comparisonRequestSchema.safeParse({ prompt: 'hi', models: [groq, groq] });
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.issues[0]?.message).toBe('Choose each model only once');
  });

  it('rejects blank and oversized prompts', () => {
    expect(
      comparisonRequestSchema.safeParse({ prompt: '   ', models: [groq, gemini] }).success,
    ).toBe(false);
    expect(
      comparisonRequestSchema.safeParse({ prompt: 'x'.repeat(16_001), models: [groq, gemini] })
        .success,
    ).toBe(false);
  });

  it('validates a single retry target', () => {
    expect(comparisonRunRequestSchema.safeParse(groq).success).toBe(true);
    expect(comparisonRunRequestSchema.safeParse({ provider: '', model: 'x' }).success).toBe(false);
  });
});

describe('parseComparisonStreamEvent', () => {
  it('parses start, done and per-run error events', () => {
    expect(
      parseComparisonStreamEvent(
        'comparison.start',
        JSON.stringify({ comparisonId: 'c1', runs: [{ runId: 'r1', ...groq }] }),
      ),
    ).toEqual({
      event: 'comparison.start',
      data: { comparisonId: 'c1', runs: [{ runId: 'r1', ...groq }] },
    });
    expect(
      parseComparisonStreamEvent(
        'message.done',
        '{"runId":"r1","status":"completed","latencyMs":900,"ttftMs":120,"estimatedCost":null}',
      )?.event,
    ).toBe('message.done');
    expect(
      parseComparisonStreamEvent(
        'error',
        '{"runId":"r2","status":"timeout","latencyMs":5000,"code":"PROVIDER_TIMEOUT","message":"slow","retryable":true}',
      ),
    ).toMatchObject({ event: 'error', data: { runId: 'r2', status: 'timeout' } });
  });

  it('returns null for unknown events, bad JSON and errors without a run id', () => {
    expect(parseComparisonStreamEvent('message.start', '{"runId":"r1"}')).toBeNull();
    expect(parseComparisonStreamEvent('message.delta', '{not json')).toBeNull();
    expect(
      parseComparisonStreamEvent(
        'error',
        '{"status":"failed","latencyMs":1,"code":"INTERNAL_ERROR","message":"x","retryable":false}',
      ),
    ).toBeNull();
    expect(parseComparisonStreamEvent('toString', '{}')).toBeNull();
  });
});
