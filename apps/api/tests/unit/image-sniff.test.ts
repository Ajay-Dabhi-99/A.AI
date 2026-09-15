import { describe, expect, it } from 'vitest';
import { sniffImage, stripImageMetadata } from '../../src/ai/image-sniff.js';
import { contains, gif, jpeg, png, svg, webp } from '../helpers/images.js';

describe('sniffImage', () => {
  it('identifies each supported type by its bytes and reads the dimensions', () => {
    expect(sniffImage(png(640, 480))).toEqual({
      mimeType: 'image/png',
      extension: 'png',
      width: 640,
      height: 480,
    });
    expect(sniffImage(jpeg(1920, 1080))).toMatchObject({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: 1920,
      height: 1080,
    });
    expect(sniffImage(webp(300, 200))).toMatchObject({
      mimeType: 'image/webp',
      width: 300,
      height: 200,
    });
    expect(sniffImage(gif(16, 9))).toMatchObject({ mimeType: 'image/gif', width: 16, height: 9 });
  });

  it('rejects SVG, text and truncated headers', () => {
    expect(sniffImage(svg())).toBeNull();
    expect(sniffImage(new TextEncoder().encode('hello'))).toBeNull();
    expect(sniffImage(png().subarray(0, 20))).toBeNull();
    // A JPEG that reaches image data before any frame header has no size.
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull();
  });
});

describe('stripImageMetadata', () => {
  it('removes PNG text chunks and keeps the image chunks', () => {
    const original = png(8, 8, { text: 'GPS 51.5007 -0.1246' });
    const stripped = stripImageMetadata(original, 'image/png');
    expect(contains(original, 'GPS 51.5007')).toBe(true);
    expect(contains(stripped, 'GPS 51.5007')).toBe(false);
    expect(contains(stripped, 'IDAT')).toBe(true);
    expect(contains(stripped, 'IEND')).toBe(true);
    expect(sniffImage(stripped)).toMatchObject({ width: 8, height: 8 });
  });

  it('removes JPEG EXIF segments and keeps the frame and scan', () => {
    const original = jpeg(10, 5, { exif: 'Canon GPS 48.8584 2.2945' });
    const stripped = stripImageMetadata(original, 'image/jpeg');
    expect(contains(stripped, 'Exif')).toBe(false);
    expect(contains(stripped, 'JFIF')).toBe(true);
    expect(sniffImage(stripped)).toMatchObject({ width: 10, height: 5 });
    expect(stripped.at(-2)).toBe(0xff);
    expect(stripped.at(-1)).toBe(0xd9);
  });

  it('removes WebP EXIF chunks, clears the flag and fixes the RIFF size', () => {
    const original = webp(30, 20, { exif: 'GPS 40.6892 -74.0445' });
    const stripped = stripImageMetadata(original, 'image/webp');
    expect(contains(stripped, 'GPS 40.6892')).toBe(false);
    expect((stripped[20] as number) & 0x08).toBe(0);
    expect(Buffer.from(stripped).readUInt32LE(4)).toBe(stripped.length - 8);
    expect(sniffImage(stripped)).toMatchObject({ width: 30, height: 20 });
  });

  it('returns GIFs unchanged and leaves clean files byte-identical', () => {
    const image = gif();
    expect(stripImageMetadata(image, 'image/gif')).toBe(image);
    expect(Buffer.from(stripImageMetadata(png(), 'image/png')).equals(Buffer.from(png()))).toBe(
      true,
    );
  });

  it('throws on malformed containers', () => {
    const truncated = jpeg(4, 4, { exif: 'x'.repeat(50) }).subarray(0, 30);
    expect(() => stripImageMetadata(truncated, 'image/jpeg')).toThrow();
    const brokenPng = png(4, 4, { text: 'note' });
    brokenPng[36] = 0xff; // chunk length far beyond the file
    expect(() => stripImageMetadata(brokenPng, 'image/png')).toThrow();
  });
});
