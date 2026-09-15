import type { CatalogModel, ModelCatalogResponse, ModelUpdateResponse } from '@a-ai/shared-types';
import { z } from 'zod';
import { aiModelSchema, providerInfoSchema } from './chat.js';

export const modelStatusSchema = z.enum(['available', 'disabled', 'provider_not_configured']);

export const catalogModelSchema = aiModelSchema.extend({
  registryId: z.string(),
  status: modelStatusSchema,
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  verifiedAt: z.string().nullable(),
  updatedAt: z.string(),
}) satisfies z.ZodType<CatalogModel>;

export const modelCatalogResponseSchema = z.object({
  models: z.array(catalogModelSchema),
  providers: z.array(providerInfoSchema),
}) satisfies z.ZodType<ModelCatalogResponse>;

export const modelUpdateResponseSchema = z.object({
  model: catalogModelSchema,
}) satisfies z.ZodType<ModelUpdateResponse>;

const price = z
  .number({ error: 'Enter a price in USD per million tokens' })
  .min(0, 'Prices cannot be negative')
  .max(10_000, 'That price looks too high')
  .nullable();

/**
 * PATCH /api/admin/models/:registryId. Every field is optional, unknown fields
 * are rejected, and at least one change is required. `verified: true` records
 * that the limits were just confirmed with a real key; `false` clears it.
 */
export const modelUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(120).optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    contextWindow: z.number().int().min(1_000).max(10_000_000).optional(),
    maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
    availability: z.enum(['free', 'free-tier', 'paid']).optional(),
    inputPricePerMillionUsd: price.optional(),
    outputPricePerMillionUsd: price.optional(),
    verified: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Change at least one field' })
  .refine(
    (body) =>
      body.maxOutputTokens === undefined ||
      body.contextWindow === undefined ||
      body.maxOutputTokens < body.contextWindow,
    { path: ['maxOutputTokens'], message: 'Must be smaller than the context window' },
  );

export type ModelUpdateRequest = z.infer<typeof modelUpdateRequestSchema>;
