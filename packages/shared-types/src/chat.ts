import type { AIModel, RunStatus } from './ai.js';

/** Chat and conversation contracts (Phase 2, docs/api/chat.md). */

export type ChatMessageRun = {
  provider: string;
  model: string;
  status: RunStatus;
  latencyMs?: number;
  errorCode?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** Present on assistant replies: which model produced it and how the run ended. */
  run?: ChatMessageRun;
};

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

/** GET /api/conversations */
export type ConversationListResponse = {
  conversations: ConversationSummary[];
};

/** GET /api/conversations/:id */
export type ConversationDetail = ConversationSummary & {
  messages: ChatMessage[];
};

/** GET /api/guest/conversation. Guests have one temporary chat that expires with their session. */
export type GuestConversationResponse = {
  messages: ChatMessage[];
  expiresAt: string;
};

/** POST /api/guest/migrate */
export type GuestMigrationResponse = {
  conversationId: string | null;
};

/** GET /api/models: only models whose provider is configured. */
export type ModelsResponse = {
  models: AIModel[];
  defaultModel: { provider: string; id: string } | null;
};
