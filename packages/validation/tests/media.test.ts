import { describe, expect, it } from 'vitest';
import {
  attachmentSchema,
  audioStatusSchema,
  jobListQuerySchema,
  mediaJobSchema,
  parseJobStreamEvent,
  transcriptionQuerySchema,
} from '../src/index.js';

const job = {
  id: 'job-1',
  kind: 'video',
  status: 'processing',
  provider: 'reels',
  model: 'reel-1',
  prompt: 'a paper boat',
  progress: 0.4,
  errorCode: null,
  attachment: null,
  createdAt: '2026-09-17T10:00:00.000Z',
  completedAt: null,
};

describe('media job contracts', () => {
  it('parses job stream events and ignores anything unexpected', () => {
    expect(parseJobStreamEvent('job', JSON.stringify(job))).toEqual({ event: 'job', data: job });
    expect(parseJobStreamEvent('ping', JSON.stringify(job))).toBeNull();
    expect(parseJobStreamEvent('job', '{not json')).toBeNull();
    expect(parseJobStreamEvent('job', JSON.stringify({ ...job, progress: 1.5 }))).toBeNull();
  });

  it('accepts generated videos without dimensions', () => {
    expect(
      mediaJobSchema.safeParse({
        ...job,
        status: 'completed',
        progress: 1,
        attachment: {
          id: 'a1',
          kind: 'video',
          mimeType: 'video/mp4',
          sizeBytes: 1024,
          width: null,
          height: null,
          fileName: null,
          source: 'generated',
          createdAt: job.createdAt,
        },
      }).success,
    ).toBe(true);
    expect(
      attachmentSchema.safeParse({
        id: 'a1',
        kind: 'video',
        mimeType: 'video/quicktime',
        sizeBytes: 1,
        width: null,
        height: null,
        fileName: null,
        source: 'generated',
        createdAt: job.createdAt,
      }).success,
    ).toBe(false);
  });

  it('bounds the job list query', () => {
    expect(jobListQuerySchema.parse({})).toEqual({ limit: 10 });
    expect(jobListQuerySchema.parse({ kind: 'video', limit: '5' })).toEqual({
      kind: 'video',
      limit: 5,
    });
    expect(jobListQuerySchema.safeParse({ kind: 'audio' }).success).toBe(false);
    expect(jobListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('audio contracts', () => {
  it('normalizes the language hint to a two-letter code', () => {
    expect(transcriptionQuerySchema.parse({ language: ' EN ' })).toEqual({ language: 'en' });
    expect(transcriptionQuerySchema.parse({})).toEqual({});
    expect(transcriptionQuerySchema.safeParse({ language: 'english' }).success).toBe(false);
  });

  it('describes browser speech and the transcription limits', () => {
    expect(
      audioStatusSchema.safeParse({
        transcription: {
          enabled: false,
          maxBytes: 10_485_760,
          maxDurationSeconds: 120,
          mimeTypes: ['audio/webm'],
        },
        speech: { mode: 'browser' },
      }).success,
    ).toBe(true);
    expect(
      audioStatusSchema.safeParse({
        transcription: { enabled: true, maxBytes: 1, maxDurationSeconds: 120, mimeTypes: [] },
        speech: { mode: 'server' },
      }).success,
    ).toBe(false);
  });
});
