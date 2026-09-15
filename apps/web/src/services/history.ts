import type {
  ComparisonDetail,
  ConversationRenameResponse,
  ConversationRunsResponse,
  HistoryKind,
  HistoryListResponse,
  UsageReport,
  UsageScope,
} from '@a-ai/shared-types';
import {
  comparisonDetailSchema,
  conversationRenameResponseSchema,
  conversationRunsResponseSchema,
  historyListResponseSchema,
  usageReportSchema,
} from '@a-ai/validation';
import { apiRequest } from './api';

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export type HistoryFilters = {
  type: 'all' | HistoryKind;
  q: string;
  /** YYYY-MM-DD, or null for all time. */
  from: string | null;
};

export const fetchHistory = (
  filters: HistoryFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<HistoryListResponse> => {
  const params = new URLSearchParams({ type: filters.type, limit: '20' });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.from) params.set('from', filters.from);
  if (cursor) params.set('cursor', cursor);
  return apiRequest(`/api/history?${params.toString()}`, {
    schema: historyListResponseSchema,
    ...withSignal(signal),
  });
};

export const fetchConversationRuns = (
  id: string,
  signal?: AbortSignal,
): Promise<ConversationRunsResponse> =>
  apiRequest(`/api/conversations/${encodeURIComponent(id)}/runs`, {
    schema: conversationRunsResponseSchema,
    ...withSignal(signal),
  });

export const fetchComparisonDetail = (
  id: string,
  signal?: AbortSignal,
): Promise<ComparisonDetail> =>
  apiRequest(`/api/comparisons/${encodeURIComponent(id)}`, {
    schema: comparisonDetailSchema,
    ...withSignal(signal),
  });

export const renameConversation = (
  id: string,
  title: string,
): Promise<ConversationRenameResponse> =>
  apiRequest(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { title },
    schema: conversationRenameResponseSchema,
  });

export const deleteHistoryItem = (kind: HistoryKind, id: string): Promise<void> =>
  apiRequest(
    `/api/${kind === 'conversation' ? 'conversations' : 'comparisons'}/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );

export const fetchUsage = (
  scope: UsageScope,
  days: number,
  signal?: AbortSignal,
): Promise<UsageReport> =>
  apiRequest(`${scope === 'deployment' ? '/api/admin/usage' : '/api/usage'}?days=${days}`, {
    schema: usageReportSchema,
    ...withSignal(signal),
  });
