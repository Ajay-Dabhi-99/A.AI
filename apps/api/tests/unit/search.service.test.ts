import { describe, expect, it } from 'vitest';
import { ChatSearchService, snippetAround } from '../../src/modules/chat/search.service.js';
import { createMemoryConversations } from '../helpers/memory-conversations.js';

describe('snippetAround', () => {
  it('returns short text whole, on one line', () => {
    expect(snippetAround('Rent is\n\n50% of pay', '50%')).toBe('Rent is 50% of pay');
  });

  it('cuts long text around the match at word boundaries, with ellipses', () => {
    const before = 'word '.repeat(30);
    const after = ' tail'.repeat(40);
    const snippet = snippetAround(`${before}NEEDLE${after}`, 'needle');
    expect(snippet.startsWith('…word')).toBe(true);
    expect(snippet.endsWith('tail…')).toBe(true);
    expect(snippet).toContain('NEEDLE');
    expect(snippet.length).toBeLessThan(160);
  });
});

describe('ChatSearchService', () => {
  it('finds chats by title or message, newest message first, only for the owner', async () => {
    const conversations = createMemoryConversations();
    const service = new ChatSearchService(conversations);
    const trip = await conversations.create({ userId: 'me', title: 'Kyoto trip' });
    await conversations.addUserMessage(trip.id, 'Temples to visit');
    const budget = await conversations.create({ userId: 'me', title: 'Money' });
    await conversations.addUserMessage(budget.id, 'Kyoto hotels are expensive');
    await conversations.addUserMessage(budget.id, 'What about KYOTO hostels?');
    const theirs = await conversations.create({ userId: 'them', title: 'Kyoto secrets' });
    await conversations.addUserMessage(theirs.id, 'kyoto');

    const { results } = await service.search('me', 'kyoto');
    expect(results.map((result) => [result.title, result.matchedIn, result.snippet])).toEqual([
      ['Money', 'message', 'What about KYOTO hostels?'],
      ['Kyoto trip', 'title', null],
    ]);
    expect((await service.search('me', 'nothing here')).results).toEqual([]);
  });
});
