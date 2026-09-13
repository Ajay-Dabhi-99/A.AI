import type { HealthResponse, ReadinessResponse } from '@a-ai/shared-types';
import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('a-ai-api'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
}) satisfies z.ZodType<HealthResponse>;

const dependencyCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: dependencyCheckSchema,
    redis: dependencyCheckSchema,
    providers: z.object({
      status: z.enum(['up', 'down']),
      configured: z.array(z.string()),
    }),
  }),
}) satisfies z.ZodType<ReadinessResponse>;
