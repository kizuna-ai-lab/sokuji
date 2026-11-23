/**
 * A minimal GGUF header reader (port of sidecar/sokuji_sidecar/gguf_header.py, spec A §3.3): `general.architecture`
 * and the set of tensor dtypes, without loading anything. Header only: the tokenizer KVs are skipped, not kept. GGUF
 * v2/v3, little-endian, read through positioned reads in chunks.
 *
 * Any truncated or malformed header — a short read, a length-prefixed string claiming more bytes than the file has,
 * bytes that are not UTF-8 — throws GgufError, worded as the Python reader words it. Callers need only catch GgufError.
 */
import fs from 'node:fs/promises';

/** ggml_type ids → ggml_type_name() spellings (ggml.h v0.25.3, native-v1.2.0). Only what a reader may meet. */
export const GGML_TYPE_NAMES: Readonly<Record<number, string>> = {
  0: 'f32', 1: 'f16', 2: 'q4_0', 3: 'q4_1', 6: 'q5_0', 7: 'q5_1', 8: 'q8_0', 9: 'q8_1',
  10: 'q2_K', 11: 'q3_K', 12: 'q4_K', 13: 'q5_K', 14: 'q6_K', 15: 'q8_K',
  16: 'iq2_xxs', 17: 'iq2_xs', 18: 'iq3_xxs', 19: 'iq1_s', 20: 'iq4_nl', 21: 'iq3_s', 22: 'iq2_s',
  23: 'iq4_xs', 24: 'i8', 25: 'i16', 26: 'i32', 27: 'i64', 28: 'f64', 29: 'iq1_m', 30: 'bf16',
  34: 'tq1_0', 35: 'tq2_0', 39: 'mxfp4',
};

/** Fixed-size KV value types and their byte sizes. */
const KV_SIZES: Readonly<Record<number, number>> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

export class GgufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GgufError';
  }
}

export interface GgufHeader {
  architecture: string;
  tensorDtypes: Set<string>;
  tensorCount: number;
}

/** A read that came up short or a string that ran past the file: the reader's own failures, made GgufError below. */
class Malformed extends Error {}

const CHUNK = 1 << 20;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Reads forward through a file in chunks, as Python's buffered file does; a seek past the end is allowed. */
class Reader {
  private buf = Buffer.alloc(0);
  private bufStart = 0;
  pos = 0;

  constructor(private readonly fh: fs.FileHandle) {}

  /** Up to `n` bytes from the current position; fewer at the end of the file. */
  async read(n: number): Promise<Buffer> {
    const end = this.pos + n;
    if (this.pos < this.bufStart || end > this.bufStart + this.buf.length) {
      const want = Math.max(n, CHUNK);
      const chunk = Buffer.alloc(want);
      const { bytesRead } = await this.fh.read(chunk, 0, want, this.pos);
      this.buf = chunk.subarray(0, bytesRead);
      this.bufStart = this.pos;
    }
    const from = this.pos - this.bufStart;
    const out = this.buf.subarray(from, Math.min(from + n, this.buf.length));
    this.pos += out.length;
    if (out.length < n) this.pos = end;            // a short read moves like a read past the end
    return out;
  }

  seek(n: number): void {
    this.pos += n;
  }

  async u32(): Promise<number> {
    const b = await this.read(4);
    if (b.length !== 4) throw new Malformed('unpack requires a buffer of 4 bytes');
    return b.readUInt32LE(0);
  }

  async u64(): Promise<bigint> {
    const b = await this.read(8);
    if (b.length !== 8) throw new Malformed('unpack requires a buffer of 8 bytes');
    return b.readBigUInt64LE(0);
  }

  async s(): Promise<string> {
    const n = await this.u64();
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Malformed(`string of length ${n} truncated to 0 bytes`);
    const buf = await this.read(Number(n));
    if (BigInt(buf.length) !== n) throw new Malformed(`string of length ${n} truncated to ${buf.length} bytes`);
    try {
      return utf8.decode(buf);
    } catch {
      throw new Malformed("'utf-8' codec can't decode the string's bytes");
    }
  }

  async skipValue(ty: number): Promise<void> {
    if (ty === 8) {
      await this.s();
      return;
    }
    if (ty === 9) {                                // array: element type, count, then the elements
      const et = await this.u32();
      const n = await this.u64();
      const size = KV_SIZES[et];
      if (size !== undefined) {
        this.seek(Number(BigInt(size) * n));
      } else {
        for (let i = 0n; i < n; i++) await this.skipValue(et);
      }
      return;
    }
    const size = KV_SIZES[ty];
    if (size !== undefined) {
      this.seek(size);
      return;
    }
    throw new GgufError(`unknown KV value type ${ty}`);
  }
}

export async function readHeader(path: string): Promise<GgufHeader> {
  const fh = await fs.open(path, 'r');
  try {
    const r = new Reader(fh);
    const magic = await r.read(4);
    if (magic.toString('latin1') !== 'GGUF') throw new GgufError(`${path}: not a GGUF file`);
    try {
      const version = await r.u32();
      if (version !== 2 && version !== 3) throw new GgufError(`${path}: unsupported GGUF version ${version}`);
      const nTensors = await r.u64();
      const nKv = await r.u64();
      let architecture = '';
      for (let i = 0n; i < nKv; i++) {
        const key = await r.s();
        const ty = await r.u32();
        if (key === 'general.architecture' && ty === 8) architecture = await r.s();
        else await r.skipValue(ty);
      }
      const types = new Set<string>();
      for (let i = 0n; i < nTensors; i++) {
        await r.s();                               // name
        const nd = await r.u32();
        for (let d = 0; d < nd; d++) await r.u64(); // dims
        types.add(GGML_TYPE_NAMES[await r.u32()] ?? 'unknown');
        await r.u64();                             // offset
      }
      return { architecture, tensorDtypes: types, tensorCount: Number(nTensors) };
    } catch (e) {
      if (e instanceof GgufError) throw e;         // already specific (version, unknown KV type)
      if (e instanceof Malformed) throw new GgufError(`${path}: truncated or malformed GGUF header (${e.message})`);
      throw e;
    }
  } finally {
    await fh.close();
  }
}
