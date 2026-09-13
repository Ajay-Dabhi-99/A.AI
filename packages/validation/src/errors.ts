import { ERROR_CODES, type ApiErrorBody } from '@a-ai/shared-types';
import { z } from 'zod';

export const errorCodeSchema = z.enum(ERROR_CODES);

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    requestId: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
}) satisfies z.ZodType<ApiErrorBody>;
