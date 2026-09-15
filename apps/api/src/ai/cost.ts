import type { AIModel, AIUsage } from '@a-ai/shared-types';

/**
 * Estimated USD cost of one run from the registry prices. Null when either
 * price is unknown or the token counts are missing: an unknown cost is never
 * shown as zero. Rounded to six decimals, matching the database column.
 */
export function estimateCostUsd(
  model: Pick<AIModel, 'inputPricePerMillionUsd' | 'outputPricePerMillionUsd'>,
  usage: Pick<AIUsage, 'inputTokens' | 'outputTokens'>,
): number | null {
  const { inputPricePerMillionUsd: inputPrice, outputPricePerMillionUsd: outputPrice } = model;
  if (inputPrice === null || outputPrice === null) return null;
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  const cost = (usage.inputTokens * inputPrice + usage.outputTokens * outputPrice) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
