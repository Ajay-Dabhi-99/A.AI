import type { AudioMimeType } from '@a-ai/shared-types';

/**
 * Audio and video container identification from raw bytes (Phase 9, ADR-016).
 * Only the container signature is read; nothing is decoded.
 */

export type SniffedAudio = { mimeType: AudioMimeType; extension: string };
export type VideoMimeType = 'video/mp4' | 'video/webm';
export type SniffedVideo = { mimeType: VideoMimeType; extension: string };

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  offset + length <= bytes.length
    ? String.fromCharCode(...bytes.subarray(offset, offset + length))
    : '';

const isEbml = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0x1a &&
  bytes[1] === 0x45 &&
  bytes[2] === 0xdf &&
  bytes[3] === 0xa3;

const isIsoMedia = (bytes: Uint8Array) => ascii(bytes, 4, 4) === 'ftyp';

export function sniffAudio(bytes: Uint8Array): SniffedAudio | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 0, 4) === 'OggS') return { mimeType: 'audio/ogg', extension: 'ogg' };
  if (isEbml(bytes)) return { mimeType: 'audio/webm', extension: 'webm' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') {
    return { mimeType: 'audio/wav', extension: 'wav' };
  }
  if (ascii(bytes, 0, 4) === 'fLaC') return { mimeType: 'audio/flac', extension: 'flac' };
  if (isIsoMedia(bytes)) return { mimeType: 'audio/mp4', extension: 'm4a' };
  if (ascii(bytes, 0, 3) === 'ID3') return { mimeType: 'audio/mpeg', extension: 'mp3' };
  // A bare MPEG audio frame: 11 sync bits, and a layer that is not "reserved".
  if (
    bytes[0] === 0xff &&
    ((bytes[1] as number) & 0xe0) === 0xe0 &&
    ((bytes[1] as number) & 0x06) !== 0
  ) {
    return { mimeType: 'audio/mpeg', extension: 'mp3' };
  }
  return null;
}

export function sniffVideo(bytes: Uint8Array): SniffedVideo | null {
  if (bytes.length < 12) return null;
  if (isIsoMedia(bytes)) {
    // An audio-only MPEG-4 file is not a video.
    if (ascii(bytes, 8, 4) === 'M4A ') return null;
    return { mimeType: 'video/mp4', extension: 'mp4' };
  }
  if (isEbml(bytes)) return { mimeType: 'video/webm', extension: 'webm' };
  return null;
}

const AUDIO_ALIASES: Record<string, AudioMimeType> = {
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'audio/x-flac': 'audio/flac',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'application/ogg': 'audio/ogg',
  // MediaRecorder and some OSes label audio-only recordings with the video container type.
  'video/webm': 'audio/webm',
  'video/mp4': 'audio/mp4',
};

/**
 * Whether the part's declared type fits the sniffed container. Codecs
 * parameters are ignored; a generic octet-stream is left to the sniffing.
 */
export function audioTypeMatches(declared: string, sniffed: AudioMimeType): boolean {
  const base = declared.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'application/octet-stream') return true;
  return (AUDIO_ALIASES[base] ?? base) === sniffed;
}
