import { describe, expect, it } from 'vitest';
import {
  ModelSummarizer,
  SUMMARY_MAX_CHARACTERS,
  SUMMARY_SYSTEM_PROMPT,
  summaryTranscript,
} from '../../src/ai/summarizer.js';
import { ScriptedProvider, testModel } from '../helpers/scripted-provider.js';

const messages = [
  { role: 'user' as const, content: 'We are planning a trip to Kyoto in November.' },
  { role: 'assistant' as const, content: 'November is maple season; book early.' },
];

describe('summaryTranscript', () => {
  it('labels speakers and puts the previous summary first', () => {
    expect(summaryTranscript('Budget is 2,000 USD.', messages, 10_000)).toBe(
      'Previous summary:\nBudget is 2,000 USD.\n\nNew messages:\nUser: We are planning a trip to Kyoto in November.\n\nAssistant: November is maple season; book early.',
    );
    expect(summaryTranscript(null, messages, 10_000).startsWith('Messages:\nUser:')).toBe(true);
  });

  it('cuts the oldest part of the transcript, never the previous summary', () => {
    const transcript = summaryTranscript('Keep me.', messages, 90);
    expect(transcript.length).toBeLessThanOrEqual(90);
    expect(transcript).toContain('Previous summary:\nKeep me.');
    expect(transcript).toContain('[earlier part omitted]');
    expect(transcript.endsWith('book early.')).toBe(true);
  });
});

describe('ModelSummarizer', () => {
  it('asks the same model for a summary with a bounded reply', async () => {
    const provider = new ScriptedProvider('scripted');
    provider.setChatReplies('  Trip to Kyoto in November; book early.  ');
    const model = testModel('scripted', 'fast-1');

    const summary = await new ModelSummarizer().summarize({
      provider,
      model,
      previousSummary: null,
      messages,
    });

    expect(summary).toBe('Trip to Kyoto in November; book early.');
    const [request] = provider.chatRequests;
    expect(request?.model).toBe('fast-1');
    expect(request?.maxOutputTokens).toBe(600);
    expect(request?.messages[0]).toEqual({ role: 'system', content: SUMMARY_SYSTEM_PROMPT });
    expect(request?.messages[1]?.content).toContain('User: We are planning a trip');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('caps a long summary', async () => {
    const provider = new ScriptedProvider('scripted');
    provider.setChatReplies('word '.repeat(2_000));
    const summary = await new ModelSummarizer().summarize({
      provider,
      model: testModel('scripted', 'fast-1'),
      previousSummary: null,
      messages,
    });
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARACTERS);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('rejects an empty reply, a provider failure and a model too small to summarize with', async () => {
    const summarizer = new ModelSummarizer();
    const provider = new ScriptedProvider('scripted');
    provider.setChatReplies('   ', new Error('provider down'));
    const input = {
      provider,
      model: testModel('scripted', 'fast-1'),
      previousSummary: null,
      messages,
    };

    await expect(summarizer.summarize(input)).rejects.toThrow(/empty summary/);
    await expect(summarizer.summarize(input)).rejects.toThrow(/provider down/);
    await expect(
      summarizer.summarize({
        ...input,
        model: testModel('scripted', 'tiny', { contextWindow: 600, maxOutputTokens: 100 }),
      }),
    ).rejects.toThrow(/too small/);
  });
});
