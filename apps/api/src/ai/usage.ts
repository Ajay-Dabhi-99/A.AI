import type { AIUsage } from '@a-ai/shared-types';

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * One usage shape for every run (blueprint §10). Provider counts are kept as
 * `provider` only when the provider reported both input and output tokens;
 * anything filled in from an estimate is labelled `estimated`, so the UI never
 * presents a guess as exact. `totalTokens` is always set.
 */
export function normalizeUsage(
  reported: AIUsage | null | undefined,
  estimate: { inputTokens: number; outputTokens: number },
): AIUsage {
  const fromProvider = reported?.source === 'provider';
  const reportedInput = reported?.inputTokens;
  const reportedOutput = reported?.outputTokens;
  const input = fromProvider && isCount(reportedInput) ? reportedInput : undefined;
  const output = fromProvider && isCount(reportedOutput) ? reportedOutput : undefined;
  const exact = input !== undefined && output !== undefined;

  const inputTokens = input ?? estimate.inputTokens;
  const outputTokens = output ?? estimate.outputTokens;
  const sum = inputTokens + outputTokens;
  const reportedTotal = reported?.totalTokens;
  // Some providers count reasoning tokens in the total only; a total below the sum is wrong.
  const totalTokens = exact && isCount(reportedTotal) && reportedTotal >= sum ? reportedTotal : sum;

  return { source: exact ? 'provider' : 'estimated', inputTokens, outputTokens, totalTokens };
}
