import type { AIModel, RunStatus } from './ai.js';
import type { Attachment } from './attachments.js';
import type { MediaJob } from './media.js';
import type { ProviderInfo } from './models.js';

/** Chat and conversation contracts (Phase 2, docs/api/chat.md). */

export type ChatMessageRun = {
  provider: string;
  model: string;
  status: RunStatus;
  latencyMs?: number;
  errorCode?: string;
  /** The model the user chose, when another model answered because it was unavailable (Phase 6). */
  fallbackFrom?: { provider: string; model: string };
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** Present on assistant replies: which model produced it and how the run ended. */
  run?: ChatMessageRun;
  /** Images sent with a user message (Phase 8). */
  attachments?: Attachment[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  /** When the owner pinned it; null when not pinned. Pinned chats list first (MODEL-062). */
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One chat found by GET /api/conversations/search (MODEL-071). */
export type ConversationSearchResult = ConversationSummary & {
  /** Where the text was found. A title match wins when both match. */
  matchedIn: 'title' | 'message';
  /** A short excerpt of the newest matching message, or null for a title-only match. */
  snippet: string | null;
};

export type ConversationSearchResponse = { results: ConversationSearchResult[] };

/** A chat's public link (MODEL-070); the web app builds the URL from the token. */
export type ConversationShare = {
  token: string;
  messageCount: number;
  /** When the link was first created. */
  createdAt: string;
  /** When the snapshot was last taken. */
  updatedAt: string;
};

/** GET and POST /api/conversations/:id/share */
export type ConversationShareResponse = { share: ConversationShare | null };

export type SharedMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** Display name of the model that answered, when known. */
  model: string | null;
};

/** GET /api/shared/:token (public) */
export type SharedConversation = {
  title: string;
  messages: SharedMessage[];
  sharedAt: string;
  /** True when only the newest messages fit in the snapshot. */
  truncated: boolean;
};

/** POST /api/chat/suggestions (MODEL-067) */
export type ChatSuggestionsResponse = {
  /** Up to three follow-up questions; empty when none could be made. */
  suggestions: string[];
};

/** GET /api/conversations */
export type ConversationListResponse = {
  conversations: ConversationSummary[];
};

/** GET /api/conversations/:id */
export type ConversationDetail = ConversationSummary & {
  messages: ChatMessage[];
  /** Images (and videos) created in this chat, oldest first (MODEL-065). */
  mediaJobs: MediaJob[];
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

/** GET /api/models: only models that can be used right now, in display order. */
export type ModelsResponse = {
  models: AIModel[];
  defaultModel: { provider: string; id: string } | null;
  /** Names for every provider in the registry; clients must not hard-code them. */
  providers: ProviderInfo[];
};
