import type { ProviderHealth, ProviderHealthResponse } from '@a-ai/shared-types';
import { z } from 'zod';
import { errorCodeSchema } from './errors.js';

export const providerHealthSchema = z.object({
  id: z.string(),
  name: z.string(),
  configured: z.boolean(),
  status: z.enum(['healthy', 'degraded', 'down', 'not_configured']),
  consecutiveFailures: z.number().int().nonnegative(),
  lastErrorCode: errorCodeSchema.nullable(),
  retryAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
}) satisfies z.ZodType<ProviderHealth>;

export const providerHealthResponseSchema = z.object({
  providers: z.array(providerHealthSchema),
}) satisfies z.ZodType<ProviderHealthResponse>;
