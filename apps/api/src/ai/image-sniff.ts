import type { AttachmentMimeType } from '@a-ai/shared-types';

/**
 * Image identification and metadata stripping from raw bytes (Phase 8,
 * ADR-015 §2–3). Only headers and container chunks are parsed; pixel data is
 * never decoded, so no image library ever runs on untrusted input.
 */

export type SniffedImage = {
  mimeType: AttachmentMimeType;
  extension: 'png' | 'jpg' | 'webp' | 'gif';
  width: number;
  height: number;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0) =>
  bytes.length >= offset + prefix.length &&
  prefix.every((value, index) => bytes[offset + index] === value);

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  offset + length <= bytes.length
    ? String.fromCharCode(...bytes.subarray(offset, offset + length))
    : '';

const u16be = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
const u16le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
const u24le = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
const u32be = (bytes: Uint8Array, offset: number) =>
  (((bytes[offset] ?? 0) << 24) >>> 0) +
  ((bytes[offset + 1] ?? 0) << 16) +
  ((bytes[offset + 2] ?? 0) << 8) +
  (bytes[offset + 3] ?? 0);
const u32le = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)) +
  (((bytes[offset + 3] ?? 0) << 24) >>> 0);

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  // The first chunk must be IHDR: length (4) + type (4) at offset 8, data at 16.
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null;
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] as number;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // image data before any frame header
    const length = u16be(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (JPEG_SOF.has(marker)) {
      if (length < 7) return null;
      return { height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(bytes, 12, 4);
  const data = 20;
  if (chunk === 'VP8X' && bytes.length >= data + 10) {
    return { width: 1 + u24le(bytes, data + 4), height: 1 + u24le(bytes, data + 7) };
  }
  if (chunk === 'VP8 ' && bytes.length >= data + 10) {
    // Key frame start code 9d 01 2a precedes the dimensions.
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a)
      return null;
    return { width: u16le(bytes, data + 6) & 0x3fff, height: u16le(bytes, data + 8) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes.length >= data + 5) {
    if (bytes[data] !== 0x2f) return null;
    const b1 = bytes[data + 1] as number;
    const b2 = bytes[data + 2] as number;
    const b3 = bytes[data + 3] as number;
    const b4 = bytes[data + 4] as number;
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  return null;
}

/** Identifies an image by its magic bytes. Null for anything else, including SVG. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    const size = pngSize(bytes);
    return size && { mimeType: 'image/png', extension: 'png', ...size };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    const size = jpegSize(bytes);
    return size && { mimeType: 'image/jpeg', extension: 'jpg', ...size };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const size = webpSize(bytes);
    return size && { mimeType: 'image/webp', extension: 'webp', ...size };
  }
  const gif = ascii(bytes, 0, 6);
  if ((gif === 'GIF87a' || gif === 'GIF89a') && bytes.length >= 10) {
    return {
      mimeType: 'image/gif',
      extension: 'gif',
      width: u16le(bytes, 6),
      height: u16le(bytes, 8),
    };
  }
  return null;
}

const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG chunk');
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return concat(parts);
}

/** APP1 (EXIF/XMP), APP13 (IPTC) and comments. */
const JPEG_METADATA_MARKERS = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('Malformed JPEG segment');
    const marker = bytes[offset + 1] as number;
    if (marker === 0xda || marker === 0xd9) {
      // Start of scan: everything after is image data (and later segments rarely carry metadata).
      parts.push(bytes.subarray(offset));
      return concat(parts);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      parts.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const end = offset + 2 + u16be(bytes, offset + 2);
    if (end > bytes.length) throw new Error('Truncated JPEG segment');
    if (!JPEG_METADATA_MARKERS.has(marker)) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  parts.push(bytes.subarray(offset));
  return concat(parts);
}

const WEBP_EXIF_FLAG = 0x08;
const WEBP_XMP_FLAG = 0x04;

function stripWebp(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = u32le(bytes, offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (offset + 8 + size > bytes.length) throw new Error('Truncated WebP chunk');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = bytes.slice(offset, Math.min(end, bytes.length));
      if (type === 'VP8X' && chunk.length > 8) {
        chunk[8] = (chunk[8] as number) & ~(WEBP_EXIF_FLAG | WEBP_XMP_FLAG);
      }
      chunks.push(chunk);
    }
    offset = end;
  }
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  const riffSize = body.length + 4;
  header[4] = riffSize & 0xff;
  header[5] = (riffSize >> 8) & 0xff;
  header[6] = (riffSize >> 16) & 0xff;
  header[7] = (riffSize >>> 24) & 0xff;
  return concat([header, body]);
}

/**
 * Removes EXIF, XMP, IPTC, text and comment metadata (location, device,
 * author) without touching pixel data. GIF is returned unchanged.
 * @throws Error when the container is malformed.
 */
export function stripImageMetadata(bytes: Uint8Array, mimeType: AttachmentMimeType): Uint8Array {
  switch (mimeType) {
    case 'image/png':
      return stripPng(bytes);
    case 'image/jpeg':
      return stripJpeg(bytes);
    case 'image/webp':
      return stripWebp(bytes);
    case 'image/gif':
      return bytes;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
