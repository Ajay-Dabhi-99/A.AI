import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from '../../src/ai/cost.js';
import { createAdapterRegistry, registryDefaults } from '../../src/providers/model-directory.js';
import {
  ModelRegistryService,
  REGISTRY_CACHE_TTL_MS,
} from '../../src/providers/model-registry.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { silentLogger, TestClock } from '../helpers/fakes.js';
import { createMemoryModelRegistry } from '../helpers/memory-model-registry.js';
import { ScriptedProvider, testModel } from '../helpers/scripted-provider.js';

const fast = testModel('alpha', 'fast');
const smart = testModel('alpha', 'smart', { name: 'Smart' });
const other = testModel('beta', 'other', { name: 'Other' });

function setup(options: { configured?: string[] } = {}) {
  const configured = options.configured ?? ['alpha'];
  const repository = createMemoryModelRegistry();
  const clock = new TestClock('2026-09-14T09:00:00.000Z');
  const logger = silentLogger();
  const adapters = createAdapterRegistry(
    configured.map((id) => ({ provider: new ScriptedProvider(id), models: [] })),
  );
  const make = () =>
    new ModelRegistryService({
      repository,
      adapters,
      defaults: registryDefaults([fast, smart, other]),
      providerNames: { alpha: 'Alpha AI' },
      clock,
      logger,
    });
  return { repository, clock, logger, make, service: make() };
}

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error(`expected AppError, got ${String(error)}`);
  return error;
}

describe('ModelRegistryService', () => {
  it('inserts catalog defaults on first use, once, without overwriting admin changes', async () => {
    const ctx = setup();
    const first = await ctx.service.catalog();
    expect(first.map((model) => model.id)).toEqual(['fast', 'smart', 'other']);

    await ctx.service.update(first[0]!.registryId, { name: 'Renamed by admin' });
    await ctx.service.catalog();
    expect(ctx.repository.insertCalls).toBe(1);

    // A new process (e.g. after a deploy) inserts again but keeps the edit.
    const restarted = ctx.make();
    const again = await restarted.catalog();
    expect(ctx.repository.rows).toHaveLength(3);
    expect(again[0]?.name).toBe('Renamed by admin');
  });

  it('reports each model as available, disabled or provider_not_configured', async () => {
    const ctx = setup();
    const [first] = await ctx.service.catalog();
    await ctx.service.update(first!.registryId, { enabled: false });

    expect((await ctx.service.catalog()).map((model) => [model.id, model.status])).toEqual([
      ['fast', 'disabled'],
      ['smart', 'available'],
      ['other', 'provider_not_configured'],
    ]);
    expect((await ctx.service.available()).map((model) => model.id)).toEqual(['smart']);
  });

  it('names providers from configuration and falls back to the id', async () => {
    const ctx = setup();
    expect(await ctx.service.providers()).toEqual([
      { id: 'alpha', name: 'Alpha AI', configured: true },
      { id: 'beta', name: 'beta', configured: false },
    ]);
  });

  it('follows sortOrder for display and for the default model', async () => {
    const ctx = setup();
    const catalog = await ctx.service.catalog();
    const smartEntry = catalog.find((model) => model.id === 'smart')!;
    await ctx.service.update(smartEntry.registryId, { sortOrder: 1 });
    expect((await ctx.service.available()).map((model) => model.id)).toEqual(['smart', 'fast']);
  });

  it('resolves only available models to their adapter', async () => {
    const ctx = setup();
    const resolved = await ctx.service.resolve('alpha', 'fast');
    expect(resolved.provider.id).toBe('alpha');
    expect(resolved.model).toMatchObject({ id: 'fast', provider: 'alpha' });

    for (const [provider, model] of [
      ['beta', 'other'],
      ['alpha', 'missing'],
    ] as const) {
      expect((await appError(ctx.service.resolve(provider, model))).code).toBe('MODEL_UNAVAILABLE');
    }
  });

  it('records verification with the clock and clears it on request', async () => {
    const ctx = setup();
    const [entry] = await ctx.service.catalog();
    expect(entry?.verifiedAt).toBeNull();

    const verified = await ctx.service.update(entry!.registryId, { verified: true });
    expect(verified.verifiedAt).toBe('2026-09-14T09:00:00.000Z');
    expect(
      (await ctx.service.update(entry!.registryId, { verified: false })).verifiedAt,
    ).toBeNull();
  });

  it('rejects an output limit that would not fit the current context window', async () => {
    const ctx = setup();
    const [entry] = await ctx.service.catalog();
    const error = await appError(
      ctx.service.update(entry!.registryId, { maxOutputTokens: entry!.contextWindow }),
    );
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'maxOutputTokens' }],
    });
  });

  it('returns NOT_FOUND for an unknown entry', async () => {
    const ctx = setup();
    expect(
      (
        await appError(
          ctx.service.update('00000000-0000-4000-8000-000000000000', { enabled: false }),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  it('caches rows until the TTL passes, and an update clears the cache immediately', async () => {
    const ctx = setup();
    await ctx.service.catalog();
    // A change made by another API instance directly in the database:
    ctx.repository.rows[0]!.name = 'Changed elsewhere';
    expect((await ctx.service.catalog())[0]?.name).not.toBe('Changed elsewhere');

    ctx.clock.advance(REGISTRY_CACHE_TTL_MS);
    expect((await ctx.service.catalog())[0]?.name).toBe('Changed elsewhere');
  });

  it('retries inserting defaults after a database failure', async () => {
    const ctx = setup();
    const original = ctx.repository.insertMissing;
    let failures = 1;
    ctx.repository.insertMissing = async (defaults) => {
      if (failures-- > 0) throw new Error('database unavailable');
      return original(defaults);
    };

    await expect(ctx.service.catalog()).rejects.toThrow('database unavailable');
    expect(await ctx.service.catalog()).toHaveLength(3);
  });
});

describe('estimateCostUsd', () => {
  it('multiplies tokens by price per million and rounds to six decimals', () => {
    expect(
      estimateCostUsd(
        { inputPricePerMillionUsd: 0.15, outputPricePerMillionUsd: 0.6 },
        { inputTokens: 1_000, outputTokens: 500 },
      ),
    ).toBe(0.00045);
    expect(
      estimateCostUsd(
        { inputPricePerMillionUsd: 1, outputPricePerMillionUsd: 1 },
        { inputTokens: 1, outputTokens: 0 },
      ),
    ).toBe(0.000001);
  });

  it('is zero for free models', () => {
    expect(
      estimateCostUsd(
        { inputPricePerMillionUsd: 0, outputPricePerMillionUsd: 0 },
        { inputTokens: 9_999, outputTokens: 9_999 },
      ),
    ).toBe(0);
  });

  it('is unknown (null) when a price or token count is missing, never zero', () => {
    expect(
      estimateCostUsd(
        { inputPricePerMillionUsd: null, outputPricePerMillionUsd: 1 },
        { inputTokens: 1, outputTokens: 1 },
      ),
    ).toBeNull();
    expect(
      estimateCostUsd(
        { inputPricePerMillionUsd: 1, outputPricePerMillionUsd: 1 },
        { outputTokens: 1 },
      ),
    ).toBeNull();
  });
});
