/** Minimal audio and video container headers for tests. Nothing here is decodable media. */

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

/** An EBML (WebM/Matroska) header followed by filler. */
export function webmAudio(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);
  return bytes;
}

export function oggAudio(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(ascii('OggS'));
  return bytes;
}

/** An ISO base media file with the given major brand ("isom" video, "M4A " audio). */
export function mp4(brand = 'isom', size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii(brand.padEnd(4).slice(0, 4))]);
  return bytes;
}
