import { AIProviderError } from '@a-ai/ai-core';
import { describe, expect, it } from 'vitest';
import {
  parseSuggestions,
  suggestionCandidates,
  SuggestionService,
} from '../../src/modules/chat/suggestion.service.js';
import { createRedisStore } from '../../src/services/kv-store.js';
import { RateLimiter } from '../../src/services/rate-limit.service.js';
import { silentLogger } from '../helpers/fakes.js';
import { ScriptedProvider, testModel } from '../helpers/scripted-provider.js';
import { controlledRedis } from '../helpers/test-app.js';

const input = { question: 'What is a vector database?', answer: 'A database for embeddings.' };
const rule = (name: string, limit = 5) => ({ name, limit, windowMs: 60_000 });

function setup(options: { enabled?: boolean; down?: string[]; limit?: number } = {}) {
  const groq = new ScriptedProvider('groq');
  const other = new ScriptedProvider('other');
  const models = [testModel('other', 'o-1'), testModel('groq', 'g-1')];
  const providers: Record<string, ScriptedProvider> = { groq, other };
  const service = new SuggestionService({
    enabled: options.enabled ?? true,
    models: {
      available: async () => models,
      resolve: async (provider, id) => ({
        provider: providers[provider]!,
        model: models.find((model) => model.provider === provider && model.id === id)!,
      }),
    },
    health: { downProviders: async () => new Set(options.down ?? []) },
    rateLimiter: new RateLimiter(createRedisStore(controlledRedis())),
    rules: {
      user: rule('s-user', options.limit),
      guest: rule('s-guest', options.limit),
      guestIp: rule('s-ip', options.limit),
    },
    logger: silentLogger(),
  });
  return { service, groq, other };
}

const user = { kind: 'user' as const, userId: 'user-1' };

describe('parseSuggestions', () => {
  it('reads a JSON array, even inside other text', () => {
    expect(
      parseSuggestions(
        'Sure!\n["How is it indexed?", "Which ones are free?", "Can I self-host it?"]',
      ),
    ).toEqual(['How is it indexed?', 'Which ones are free?', 'Can I self-host it?']);
  });

  it('falls back to lines, strips numbering and quotes, dedupes and keeps three', () => {
    expect(
      parseSuggestions(
        '1. "How fast is it?"\n- how fast is it?\n2) Is it free?\n* ok\n3. Why?!\n4. More?',
      ),
    ).toEqual(['How fast is it?', 'Is it free?', 'Why?!']);
  });

  it('returns nothing for empty or unusable replies', () => {
    expect(parseSuggestions('')).toEqual([]);
    expect(parseSuggestions('[1, 2, {"a": 3}]')).toEqual([]);
    expect(parseSuggestions(`["${'x'.repeat(200)}"]`)).toEqual([]);
  });
});

describe('suggestionCandidates', () => {
  it('prefers Groq, skips providers that are down and non-text models', () => {
    const models = [
      testModel('other', 'o-1'),
      testModel('groq', 'g-1'),
      testModel('down', 'd-1'),
      testModel('other', 'img', { category: 'image' }),
    ];
    expect(
      suggestionCandidates(models, new Set(['down'])).map(
        (model) => `${model.provider}/${model.id}`,
      ),
    ).toEqual(['groq/g-1', 'other/o-1']);
  });
});

describe('SuggestionService', () => {
  it('asks the preferred model with the question and the answer', async () => {
    const { service, groq, other } = setup();
    groq.setChatReplies('["How is it indexed?", "Is it free?", "Can I host it?"]');

    expect(await service.suggest(user, input)).toEqual({
      suggestions: ['How is it indexed?', 'Is it free?', 'Can I host it?'],
    });
    expect(other.chatRequests).toHaveLength(0);
    const [request] = groq.chatRequests;
    expect(request?.model).toBe('g-1');
    expect(request?.messages[0]?.role).toBe('system');
    expect(request?.messages[1]?.content).toContain(input.question);
    expect(request?.messages[1]?.content).toContain(input.answer);
  });

  it('tries the next model when one fails or says nothing useful, then gives up quietly', async () => {
    const first = setup();
    first.groq.setChatReplies(
      new AIProviderError({ provider: 'groq', code: 'RATE_LIMITED', message: 'slow down' }),
    );
    first.other.setChatReplies('["Is it free?"]');
    expect(await first.service.suggest(user, input)).toEqual({ suggestions: ['Is it free?'] });

    const second = setup();
    second.groq.setChatReplies('');
    second.other.setChatReplies(new Error('boom'));
    expect(await second.service.suggest(user, input)).toEqual({ suggestions: [] });
  });

  it('skips a provider that is down', async () => {
    const { service, groq, other } = setup({ down: ['groq'] });
    other.setChatReplies('["Is it free?"]');
    expect(await service.suggest(user, input)).toEqual({ suggestions: ['Is it free?'] });
    expect(groq.chatRequests).toHaveLength(0);
  });

  it('does nothing when turned off, and limits callers', async () => {
    const off = setup({ enabled: false });
    expect(await off.service.suggest(user, input)).toEqual({ suggestions: [] });
    expect(off.groq.chatRequests).toHaveLength(0);

    const limited = setup({ limit: 1 });
    limited.groq.setChatReplies('["One?"]', '["Two?"]');
    await limited.service.suggest(user, input);
    await expect(limited.service.suggest(user, input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(
      limited.service.suggest({ kind: 'guest', guestId: 'g1', ipHash: 'ip1' }, input),
    ).resolves.toEqual({ suggestions: ['Two?'] });
  });
});
