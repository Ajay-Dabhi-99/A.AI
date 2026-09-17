import type {
  ComparisonDetail,
  ConversationUpdateResponse,
  ConversationRunsResponse,
  HistoryItem,
  HistoryListResponse,
  RunDetail,
  UsageByDay,
  UsageByModel,
  UsageReport,
  UsageTotals,
} from '@a-ai/shared-types';
import { z } from 'zod';

export const HISTORY_PAGE_SIZE_MAX = 50;
export const HISTORY_SEARCH_MAX_LENGTH = 120;
export const CONVERSATION_TITLE_MAX_LENGTH = 120;
export const USAGE_MAX_DAYS = 90;

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Not a real date');

const blankToUndefined = (value: string | undefined) => (value ? value : undefined);

/** GET /api/history query string. */
export const historyQuerySchema = z
  .object({
    type: z.enum(['all', 'conversation', 'comparison']).default('all'),
    q: z.string().trim().max(HISTORY_SEARCH_MAX_LENGTH).transform(blankToUndefined).optional(),
    provider: z.string().trim().min(1).max(32).optional(),
    model: z.string().trim().min(1).max(128).optional(),
    from: isoDay.optional(),
    to: isoDay.optional(),
    cursor: z.string().max(200).transform(blankToUndefined).optional(),
    limit: z.coerce.number().int().min(1).max(HISTORY_PAGE_SIZE_MAX).default(20),
  })
  .refine((query) => (query.model === undefined) === (query.provider === undefined), {
    path: ['model'],
    message: 'Filter by provider and model together',
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'The end date must not be before the start date',
  });

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** PATCH /api/conversations/:id: rename, pin or unpin (at least one field). */
export const conversationUpdateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Enter a title')
      .max(
        CONVERSATION_TITLE_MAX_LENGTH,
        `Titles can be at most ${CONVERSATION_TITLE_MAX_LENGTH} characters`,
      )
      .optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.title !== undefined || body.pinned !== undefined, {
    message: 'Send a title or a pinned state',
  });

export type ConversationUpdate = z.infer<typeof conversationUpdateSchema>;

/** GET /api/usage and GET /api/admin/usage query string. */
export const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(USAGE_MAX_DAYS).default(30),
});

const modelRefSchema = z.object({ provider: z.string(), model: z.string() });
const count = z.number().int().nonnegative();
const nullableMs = z.number().nonnegative().nullable();

export const historyItemSchema = z.object({
  kind: z.enum(['conversation', 'comparison']),
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  runCount: count,
  failedRunCount: count,
  models: z.array(modelRefSchema),
  estimatedCostUsd: z.number().nonnegative().nullable(),
}) satisfies z.ZodType<HistoryItem>;

export const historyListResponseSchema = z.object({
  items: z.array(historyItemSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<HistoryListResponse>;

export const runDetailSchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'timeout']),
  provider: z.string(),
  model: z.string(),
  requested: modelRefSchema.nullable(),
  attemptCount: z.number().int().positive(),
  fallbackReason: z.string().nullable(),
  ttftMs: nullableMs,
  latencyMs: nullableMs,
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
  usageSource: z.enum(['provider', 'estimated']).nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
}) satisfies z.ZodType<RunDetail>;

const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  // Defaults to unpinned so the web app still reads an API from before MODEL-062.
  pinnedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const conversationRunsResponseSchema = z.object({
  conversation: conversationSummarySchema,
  runs: z.array(runDetailSchema.extend({ messageId: z.string().nullable() })),
}) satisfies z.ZodType<ConversationRunsResponse>;

export const comparisonDetailSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  createdAt: z.string(),
  runs: z.array(
    runDetailSchema.extend({
      position: z.number().int().nonnegative(),
      content: z.string().nullable(),
    }),
  ),
}) satisfies z.ZodType<ComparisonDetail>;

export const conversationUpdateResponseSchema = z.object({
  conversation: conversationSummarySchema,
}) satisfies z.ZodType<ConversationUpdateResponse>;

const usageTotalsShape = {
  runs: count,
  completedRuns: count,
  failedRuns: count,
  cancelledRuns: count,
  inputTokens: count,
  outputTokens: count,
  providerCountedRuns: count,
  estimatedCostUsd: z.number().nonnegative(),
  costedRuns: count,
  averageLatencyMs: nullableMs,
  p95LatencyMs: nullableMs,
  fallbackRuns: count,
};

export const usageTotalsSchema = z.object(usageTotalsShape) satisfies z.ZodType<UsageTotals>;

export const usageByModelSchema = z.object({
  ...usageTotalsShape,
  provider: z.string(),
  model: z.string(),
}) satisfies z.ZodType<UsageByModel>;

export const usageByDaySchema = z.object({
  day: z.string(),
  runs: count,
  failedRuns: count,
  inputTokens: count,
  outputTokens: count,
  estimatedCostUsd: z.number().nonnegative(),
}) satisfies z.ZodType<UsageByDay>;

export const usageReportSchema = z.object({
  scope: z.enum(['personal', 'deployment']),
  range: z.object({ from: z.string(), to: z.string(), days: z.number().int().positive() }),
  totals: usageTotalsSchema,
  byModel: z.array(usageByModelSchema),
  byDay: z.array(usageByDaySchema),
  activeUsers: count.nullable(),
}) satisfies z.ZodType<UsageReport>;
