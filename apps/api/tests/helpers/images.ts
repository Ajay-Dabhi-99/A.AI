/**
 * Minimal, structurally valid image files built byte by byte, so tests control
 * exactly which headers and metadata blocks a file contains.
 */

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >> 8) & 255];
const u24le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

function pngChunk(type: string, data: number[]): number[] {
  // CRCs are not checked by the API (it never decodes pixels), so zeros suffice.
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

/** A PNG, optionally with a tEXt chunk holding `text`. */
export function png(width = 4, height = 3, options: { text?: string } = {}): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', [...u32be(width), ...u32be(height), 8, 2, 0, 0, 0]),
    ...(options.text ? pngChunk('tEXt', ascii(`Comment\0${options.text}`)) : []),
    ...pngChunk('IDAT', [1, 2, 3, 4]),
    ...pngChunk('IEND', []),
  ]);
}

function jpegSegment(marker: number, data: number[]): number[] {
  return [0xff, marker, ...u16be(data.length + 2), ...data];
}

/** A baseline JPEG, optionally with an APP1 EXIF segment holding `exif`. */
export function jpeg(width = 4, height = 3, options: { exif?: string } = {}): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    ...jpegSegment(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...(options.exif ? jpegSegment(0xe1, ascii(`Exif\0\0${options.exif}`)) : []),
    ...jpegSegment(0xc0, [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0]),
    ...jpegSegment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12,
    0x34,
    0x56,
    0xff,
    0xd9,
  ]);
}

function riffChunk(type: string, data: number[]): number[] {
  return [...ascii(type), ...u32le(data.length), ...data, ...(data.length % 2 ? [0] : [])];
}

/** An extended WebP (VP8X), optionally with an EXIF chunk holding `exif`. */
export function webp(width = 4, height = 3, options: { exif?: string } = {}): Uint8Array {
  const body = [
    ...ascii('WEBP'),
    ...riffChunk('VP8X', [
      options.exif ? 0x08 : 0,
      0,
      0,
      0,
      ...u24le(width - 1),
      ...u24le(height - 1),
    ]),
    ...riffChunk('VP8 ', [
      0x30,
      0x01,
      0x00,
      0x9d,
      0x01,
      0x2a,
      ...u16le(width),
      ...u16le(height),
      0,
      0,
    ]),
    ...(options.exif ? riffChunk('EXIF', ascii(options.exif)) : []),
  ];
  return Uint8Array.from([...ascii('RIFF'), ...u32le(body.length), ...body]);
}

export function gif(width = 4, height = 3): Uint8Array {
  return Uint8Array.from([...ascii('GIF89a'), ...u16le(width), ...u16le(height), 0, 0, 0, 0x3b]);
}

export const svg = (): Uint8Array =>
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );

export function contains(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));
}

export type MultipartPart = {
  name: string;
  filename?: string;
  contentType?: string;
  data: Uint8Array | string;
};

/** A multipart/form-data body for app.inject. */
export function multipartBody(parts: MultipartPart[]): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = 'a-ai-test-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) header += `; filename="${part.filename}"`;
    header += '\r\n';
    if (part.contentType) header += `Content-Type: ${part.contentType}\r\n`;
    header += '\r\n';
    chunks.push(Buffer.from(header), Buffer.from(part.data), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
