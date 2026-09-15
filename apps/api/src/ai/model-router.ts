import type { AIModel } from '@a-ai/shared-types';

/**
 * Fallback candidates in a fixed, testable order (ADR-013):
 *
 * 1. Only models of the same category that are available right now.
 * 2. Never the model that failed, and never a provider whose circuit is open.
 * 3. Models of other providers first (a timeout, 429 or outage usually affects
 *    the whole provider), then the failed provider's other models.
 * 4. Within each group, registry order: the order admins set on /models.
 * 5. When the request carries images, only models that support vision (ADR-015).
 */
export function fallbackCandidates(
  failed: Pick<AIModel, 'provider' | 'id' | 'category'>,
  available: readonly AIModel[],
  isProviderDown: (providerId: string) => boolean,
  requirements: { vision?: boolean } = {},
): AIModel[] {
  const eligible = available.filter(
    (model) =>
      model.category === failed.category &&
      !(model.provider === failed.provider && model.id === failed.id) &&
      !isProviderDown(model.provider) &&
      (!requirements.vision || model.supportsVision),
  );
  return [
    ...eligible.filter((model) => model.provider !== failed.provider),
    ...eligible.filter((model) => model.provider === failed.provider),
  ];
}
