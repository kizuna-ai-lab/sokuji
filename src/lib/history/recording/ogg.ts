// src/lib/history/recording/ogg.ts
//
// An Ogg Opus stream (RFC 3533 pages, RFC 7845 mapping), written as it goes: the head and tags pages first, then
// pages of the packets given since the last take. Ogg pages delimit themselves, so a file cut short after any
// complete page still plays up to it.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** Ogg's CRC-32: polynomial 0x04C11DB7, initial value 0, not reflected, no final xor. */
export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** The OpusHead's pre-skip: the 48 kHz samples a decoder drops at the start (little-endian u16 at byte 10). */
export function opusPreSkip(opusHead: Uint8Array): number {
  return opusHead[10] | (opusHead[11] << 8);
}

const HEADER_BOS = 2;
const HEADER_EOS = 4;
/** A page's segment table holds at most this many lacing values. */
const MAX_SEGMENTS = 255;

export interface OggOpusWriter {
  /** The OpusHead page (beginning of stream) and the OpusTags page. */
  begin(): Uint8Array;
  /** One Opus packet that decodes to `samples48k` samples at 48 kHz. */
  packet(data: Uint8Array, samples48k: number): void;
  /** Complete pages for the packets given since the last take; `end` marks the end of the stream. */
  take(end?: boolean): { bytes: Uint8Array; durationMs: number };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const lacingOf = (length: number): number[] => {
  const values = new Array<number>(Math.floor(length / 255)).fill(255);
  values.push(length % 255);
  return values;
};

export function createOggOpusWriter(o: { serial: number; opusHead: Uint8Array }): OggOpusWriter {
  const preSkip = opusPreSkip(o.opusHead);
  let sequence = 0;
  let granule = 0;
  let pending: Array<{ data: Uint8Array; samples48k: number }> = [];

  function page(type: number, granulePos: number, packets: readonly Uint8Array[]): Uint8Array {
    const lacing = packets.flatMap((p) => lacingOf(p.length));
    const header = new Uint8Array(27 + lacing.length);
    const view = new DataView(header.buffer);
    header.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
    header[4] = 0;
    header[5] = type;
    view.setBigUint64(6, BigInt(granulePos), true);
    view.setUint32(14, o.serial >>> 0, true);
    view.setUint32(18, sequence++, true);
    header[26] = lacing.length;
    header.set(lacing, 27);
    const bytes = concat([header, ...packets]);
    new DataView(bytes.buffer).setUint32(22, oggCrc(bytes), true);
    return bytes;
  }

  return {
    begin() {
      const vendor = new TextEncoder().encode('Sokuji');
      const tags = new Uint8Array(8 + 4 + vendor.length + 4);
      tags.set(new TextEncoder().encode('OpusTags'), 0);
      new DataView(tags.buffer).setUint32(8, vendor.length, true);
      tags.set(vendor, 12);
      // No user comments: the count stays 0.
      return concat([page(HEADER_BOS, 0, [o.opusHead]), page(0, 0, [tags])]);
    },

    packet(data, samples48k) {
      pending.push({ data, samples48k });
    },

    take(end = false) {
      const pages: Uint8Array[] = [];
      let i = 0;
      while (i < pending.length) {
        const packets: Uint8Array[] = [];
        let segments = 0;
        while (i < pending.length && segments + lacingOf(pending[i].data.length).length <= MAX_SEGMENTS) {
          segments += lacingOf(pending[i].data.length).length;
          granule += pending[i].samples48k;
          packets.push(pending[i].data);
          i += 1;
        }
        const last = i >= pending.length;
        pages.push(page(end && last ? HEADER_EOS : 0, granule, packets));
      }
      pending = [];
      return { bytes: concat(pages), durationMs: Math.max(0, Math.round((granule - preSkip) / 48)) };
    },
  };
}
