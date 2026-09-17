import type { ConversationSearchResponse } from '@a-ai/shared-types';
import { CHAT_SEARCH_LIMIT } from '@a-ai/validation';
import type { ConversationRepository } from '../../repositories/conversation.repository.js';
import { toConversationSummary } from './mappers.js';

const BEFORE = 40;
const AFTER = 100;

/**
 * A short excerpt around the first case-insensitive occurrence of `text`,
 * on one line, with ellipses where it was cut.
 */
export function snippetAround(content: string, text: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(text.toLowerCase());
  if (at < 0) return flat.slice(0, BEFORE + AFTER) + (flat.length > BEFORE + AFTER ? '…' : '');
  let start = Math.max(0, at - BEFORE);
  let end = Math.min(flat.length, at + text.length + AFTER);
  // Avoid cutting words in half.
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > at + text.length) end = space;
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** Finds a user's chats by title or message text (MODEL-071). */
export class ChatSearchService {
  readonly #conversations: Pick<ConversationRepository, 'search'>;

  constructor(conversations: Pick<ConversationRepository, 'search'>) {
    this.#conversations = conversations;
  }

  async search(userId: string, text: string): Promise<ConversationSearchResponse> {
    const rows = await this.#conversations.search(userId, text, CHAT_SEARCH_LIMIT);
    return {
      results: rows.map(({ conversation, match }) => {
        const inTitle = conversation.title.toLowerCase().includes(text.toLowerCase());
        return {
          ...toConversationSummary(conversation),
          matchedIn: inTitle || match === null ? 'title' : 'message',
          snippet: match === null ? null : snippetAround(match, text),
        };
      }),
    };
  }
}
