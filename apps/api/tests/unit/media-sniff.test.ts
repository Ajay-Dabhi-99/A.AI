import { describe, expect, it } from 'vitest';
import { audioTypeMatches, sniffAudio, sniffVideo } from '../../src/ai/media-sniff.js';
import { png } from '../helpers/images.js';
import { mp4, oggAudio, webmAudio } from '../helpers/media.js';

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
const padded = (bytes: number[]) => Uint8Array.from([...bytes, ...new Array(16).fill(0)]);

describe('sniffAudio', () => {
  it('identifies every accepted recording container', () => {
    expect(sniffAudio(webmAudio())).toEqual({ mimeType: 'audio/webm', extension: 'webm' });
    expect(sniffAudio(oggAudio())).toEqual({ mimeType: 'audio/ogg', extension: 'ogg' });
    expect(sniffAudio(padded([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]))).toMatchObject({
      mimeType: 'audio/wav',
    });
    expect(sniffAudio(padded(ascii('fLaC')))).toMatchObject({ mimeType: 'audio/flac' });
    expect(sniffAudio(mp4('M4A '))).toEqual({ mimeType: 'audio/mp4', extension: 'm4a' });
    expect(sniffAudio(padded(ascii('ID3')))).toMatchObject({ mimeType: 'audio/mpeg' });
    expect(sniffAudio(padded([0xff, 0xfb, 0x90, 0x64]))).toMatchObject({ mimeType: 'audio/mpeg' });
  });

  it('rejects images, text and too-short input', () => {
    expect(sniffAudio(png())).toBeNull();
    expect(sniffAudio(new TextEncoder().encode('just some plain text here'))).toBeNull();
    expect(sniffAudio(Uint8Array.from(ascii('OggS')))).toBeNull();
    // Sync bits with the reserved layer are not MPEG audio.
    expect(sniffAudio(padded([0xff, 0xe0]))).toBeNull();
  });
});

describe('sniffVideo', () => {
  it('accepts MP4 and WebM but not audio-only MPEG-4', () => {
    expect(sniffVideo(mp4('isom'))).toEqual({ mimeType: 'video/mp4', extension: 'mp4' });
    expect(sniffVideo(webmAudio())).toEqual({ mimeType: 'video/webm', extension: 'webm' });
    expect(sniffVideo(mp4('M4A '))).toBeNull();
    expect(sniffVideo(png())).toBeNull();
  });
});

describe('audioTypeMatches', () => {
  it('ignores codecs and accepts the names browsers use', () => {
    expect(audioTypeMatches('audio/webm;codecs=opus', 'audio/webm')).toBe(true);
    expect(audioTypeMatches('video/webm', 'audio/webm')).toBe(true);
    expect(audioTypeMatches('audio/x-m4a', 'audio/mp4')).toBe(true);
    expect(audioTypeMatches('audio/mp3', 'audio/mpeg')).toBe(true);
    expect(audioTypeMatches('application/octet-stream', 'audio/ogg')).toBe(true);
  });

  it('rejects a declared type that is a different container', () => {
    expect(audioTypeMatches('audio/mpeg', 'audio/ogg')).toBe(false);
    expect(audioTypeMatches('image/png', 'audio/webm')).toBe(false);
  });
});
