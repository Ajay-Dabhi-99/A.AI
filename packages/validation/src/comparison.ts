import type {
  ComparisonModelRef,
  ComparisonStreamEvent,
  ComparisonStreamEventMap,
  ComparisonStreamEventName,
} from '@a-ai/shared-types';
import { z } from 'zod';
import { CHAT_MESSAGE_MAX_LENGTH, usageSchema } from './chat.js';
import { errorCodeSchema } from './errors.js';

/** A comparison needs at least two models; no plan may run more than four at once (blueprint §13). */
export const COMPARE_MIN_MODELS = 2;
export const COMPARE_MAX_MODELS = 4;

export const comparisonModelRefSchema = z.object({
  provider: z.string().min(1).max(32),
  model: z.string().min(1).max(128),
}) satisfies z.ZodType<ComparisonModelRef>;

/** POST /api/compare. The per-identity limit (guests 2, users 4 by default) is checked by the API. */
export const comparisonRequestSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, 'Write a prompt first')
    .max(CHAT_MESSAGE_MAX_LENGTH, `Prompts can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`),
  models: z
    .array(comparisonModelRefSchema)
    .min(COMPARE_MIN_MODELS, `Choose at least ${COMPARE_MIN_MODELS} models to compare`)
    .max(COMPARE_MAX_MODELS, `You can compare at most ${COMPARE_MAX_MODELS} models`)
    .refine(
      (models) =>
        new Set(models.map((ref) => JSON.stringify([ref.provider, ref.model]))).size ===
        models.length,
      'Choose each model only once',
    ),
});

export type ComparisonRequest = z.infer<typeof comparisonRequestSchema>;

/** POST /api/compare/:comparisonId/runs: run the comparison's prompt again on one model. */
export const comparisonRunRequestSchema = comparisonModelRefSchema;

export type ComparisonRunRequest = z.infer<typeof comparisonRunRequestSchema>;

export const comparisonStreamEventSchemas = {
  'comparison.start': z.object({
    comparisonId: z.string(),
    runs: z.array(z.object({ runId: z.string(), provider: z.string(), model: z.string() })),
  }),
  'message.delta': z.object({ runId: z.string(), text: z.string() }),
  usage: z.object({ runId: z.string(), usage: usageSchema }),
  'message.done': z.object({
    runId: z.string(),
    status: z.enum(['completed', 'cancelled']),
    latencyMs: z.number().nonnegative(),
    ttftMs: z.number().nonnegative().nullable(),
    estimatedCost: z.number().nonnegative().nullable(),
  }),
  error: z.object({
    runId: z.string(),
    status: z.enum(['failed', 'timeout']),
    latencyMs: z.number().nonnegative(),
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
  'comparison.done': z.object({ comparisonId: z.string() }),
} satisfies {
  [Name in ComparisonStreamEventName]: z.ZodType<ComparisonStreamEventMap[Name]>;
};

/** Validates one SSE event from the comparison stream. Unknown or malformed events return null. */
export function parseComparisonStreamEvent(
  event: string,
  data: string,
): ComparisonStreamEvent | null {
  if (!Object.hasOwn(comparisonStreamEventSchemas, event)) return null;
  const name = event as ComparisonStreamEventName;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = comparisonStreamEventSchemas[name].safeParse(json);
  return parsed.success ? ({ event: name, data: parsed.data } as ComparisonStreamEvent) : null;
}
