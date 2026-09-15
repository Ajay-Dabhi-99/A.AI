import type { ImageGenerationStatus, ImageJobResponse } from '@a-ai/shared-types';
import {
  imageGenerationStatusSchema,
  imageJobResponseSchema,
  type ImageGenerateRequest,
} from '@a-ai/validation';
import { apiRequest } from './api';

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const fetchImageStatus = (signal?: AbortSignal): Promise<ImageGenerationStatus> =>
  apiRequest('/api/image/status', { schema: imageGenerationStatusSchema, ...withSignal(signal) });

export const startImageJob = (body: ImageGenerateRequest): Promise<ImageJobResponse> =>
  apiRequest('/api/image/generate', { method: 'POST', body, schema: imageJobResponseSchema });

export const fetchImageJob = (id: string, signal?: AbortSignal): Promise<ImageJobResponse> =>
  apiRequest(`/api/image/${encodeURIComponent(id)}`, {
    schema: imageJobResponseSchema,
    ...withSignal(signal),
  });
