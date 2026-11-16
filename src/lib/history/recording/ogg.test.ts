// The Ogg Opus stream a recording track is written as (RFC 3533 pages, RFC 7845 Opus mapping).
import { describe, it, expect } from 'vitest';
import { createOggOpusWriter, oggCrc, opusPreSkip } from './ogg';

// The 19-byte OpusHead Chromium's encoder gave for 24 kHz mono (pre-skip 156).
const HEAD = new Uint8Array([79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 156, 0, 192, 93, 0, 0, 0, 0, 0]);

interface Page { type: number; granule: bigint; serial: number; sequence: number; crcOk: boolean; packets: Uint8Array[]; lacing: number[] }

/** Reads pages back: capture pattern, header, CRC, and the packets the segment table delimits. */
function parsePages(bytes: Uint8Array): Page[] {
  const pages: Page[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  let open: number[] = [];
  while (at < bytes.length) {
    expect(new TextDecoder().decode(bytes.slice(at, at + 4))).toBe('OggS');
    const nSegs = bytes[at + 26];
    const lacing = Array.from(bytes.slice(at + 27, at + 27 + nSegs));
    const headerLen = 27 + nSegs;
    const bodyLen = lacing.reduce((a, b) => a + b, 0);
    const page = bytes.slice(at, at + headerLen + bodyLen);
    const zeroed = page.slice();
    zeroed.set([0, 0, 0, 0], 22);
    const crcOk = oggCrc(zeroed) === view.getUint32(at + 22, true);
    const packets: Uint8Array[] = [];
    let p = at + headerLen;
    for (const l of lacing) {
      open.push(...bytes.slice(p, p + l));
      p += l;
      if (l < 255) { packets.push(new Uint8Array(open)); open = []; }
    }
    pages.push({ type: bytes[at + 5], granule: view.getBigUint64(at + 6, true), serial: view.getUint32(at + 14, true), sequence: view.getUint32(at + 18, true), crcOk, packets, lacing });
    at += headerLen + bodyLen;
  }
  return pages;
}

describe('the Ogg Opus writer', () => {
  it('computes the Ogg CRC', () => {
    expect(oggCrc(new TextEncoder().encode('123456789'))).toBe(0x89a1897f);
  });

  it('reads the pre-skip from the OpusHead', () => {
    expect(opusPreSkip(HEAD)).toBe(156);
  });

  it('starts the stream with a head page and a tags page', () => {
    const w = createOggOpusWriter({ serial: 7, opusHead: HEAD });
    const pages = parsePages(w.begin());
    expect(pages.map((p) => [p.type, p.granule, p.sequence, p.serial])).toEqual([[2, 0n, 0, 7], [0, 0n, 1, 7]]);
    expect(pages[0].packets[0]).toEqual(HEAD);
    expect(new TextDecoder().decode(pages[1].packets[0].slice(0, 8))).toBe('OpusTags');
    expect(pages.every((p) => p.crcOk)).toBe(true);
  });

  it('puts the packets given since the last take on pages with their granule position', () => {
    const w = createOggOpusWriter({ serial: 7, opusHead: HEAD });
    w.begin();
    for (let i = 0; i < 50; i++) w.packet(new Uint8Array(121).fill(i), 960);
    const { bytes, durationMs } = w.take();
    const pages = parsePages(bytes);
    expect(pages[pages.length - 1].granule).toBe(48000n);
    expect(pages.every((p) => p.crcOk && p.sequence >= 2)).toBe(true);
    expect(durationMs).toBe(Math.round((48000 - 156) / 48));
    expect(pages.flatMap((p) => p.packets)).toHaveLength(50);
    expect(pages.flatMap((p) => p.packets)[3]).toEqual(new Uint8Array(121).fill(3));
  });

  it('splits a long packet into lacing values and never puts more than 255 segments on a page', () => {
    const w = createOggOpusWriter({ serial: 1, opusHead: HEAD });
    w.begin();
    w.packet(new Uint8Array(600).fill(9), 960);
    w.packet(new Uint8Array(255).fill(8), 960);
    const first = parsePages(w.take().bytes);
    expect(first[0].lacing).toEqual([255, 255, 90, 255, 0]);
    expect(first[0].packets.map((p) => p.length)).toEqual([600, 255]);
    for (let i = 0; i < 300; i++) w.packet(new Uint8Array(3), 960);
    const many = parsePages(w.take().bytes);
    expect(many.length).toBe(2);
    expect(many.every((p) => p.lacing.length <= 255)).toBe(true);
    expect(many.flatMap((p) => p.packets)).toHaveLength(300);
    expect(many[1].granule).toBe(BigInt(302 * 960));
  });

  it('marks the end of the stream on the last page', () => {
    const w = createOggOpusWriter({ serial: 1, opusHead: HEAD });
    w.begin();
    w.packet(new Uint8Array(3), 960);
    const pages = parsePages(w.take(true).bytes);
    expect(pages[pages.length - 1].type & 4).toBe(4);
  });

  it('returns nothing to write when no packet came', () => {
    const w = createOggOpusWriter({ serial: 1, opusHead: HEAD });
    w.begin();
    expect(w.take().bytes.length).toBe(0);
  });
});
