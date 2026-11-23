// @vitest-environment node
/**
 * The GGUF v2/v3 header reader (ported from sidecar/tests/test_gguf_header.py): the architecture and the tensor dtype
 * set, read from a file written here, and every golden case the Python reader answered.
 */
import './test/env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import golden from './test/golden/gguf.json';
import { GgufError, readHeader } from './ggufHeader';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const str = (x: string) => { const b = Buffer.from(x, 'utf8'); return Buffer.concat([u64(b.length), b]); };

/** The synthetic GGUF of the Python test: header and tensor infos, no data. `tensors`: (name, ggml type id). */
function writeGguf(file: string, arch: string, tensors: Array<[string, number]>, version = 3): string {
  const parts: Buffer[] = [Buffer.from('GGUF'), u32(version), u64(tensors.length), u64(2)];
  parts.push(str('general.architecture'), u32(8), str(arch));
  // An array of strings: must be skipped.
  parts.push(str('tokenizer.ggml.tokens'), u32(9), u32(8), u64(2), str('a'), str('b'));
  for (const [name, ty] of tensors) parts.push(str(name), u32(2), u64(4), u64(4), u32(ty), u64(0));
  const p = path.join(dir, file);
  fs.writeFileSync(p, Buffer.concat(parts));
  return p;
}

const TOY: Array<[string, number]> = [['token_embd.weight', 8], ['blk.0.attn_q.weight', 12], ['blk.0.norm.weight', 0], ['output.weight', 30]];

describe('readHeader', () => {
  it('reads the architecture and the dtype set', async () => {
    const h = await readHeader(writeGguf('toy.gguf', 'qwen3', TOY));
    expect(h.architecture).toBe('qwen3');
    expect(h.tensorCount).toBe(4);
    expect(h.tensorDtypes).toEqual(new Set(['q8_0', 'q4_K', 'f32', 'bf16']));
  });

  it('rejects a file that is not GGUF', async () => {
    const p = path.join(dir, 'x.bin');
    fs.writeFileSync(p, Buffer.concat([Buffer.from('NOPE'), Buffer.alloc(64)]));
    await expect(readHeader(p)).rejects.toBeInstanceOf(GgufError);
  });

  it('a truncated or corrupted GGUF raises GgufError, not a raw error', async () => {
    const bare = path.join(dir, 'bare.gguf');
    fs.writeFileSync(bare, 'GGUF');
    await expect(readHeader(bare)).rejects.toBeInstanceOf(GgufError);
    const cut = path.join(dir, 'cut.gguf');
    fs.writeFileSync(cut, fs.readFileSync(writeGguf('toy2.gguf', 'qwen3', TOY)).subarray(0, 40));
    await expect(readHeader(cut)).rejects.toBeInstanceOf(GgufError);
    const badLen = path.join(dir, 'bad_len.gguf');
    fs.writeFileSync(badLen, Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(1), str('general.architecture'), u32(8), u64(10_000), Buffer.from('short')]));
    await expect(readHeader(badLen)).rejects.toThrow(`${badLen}: truncated or malformed GGUF header (string of length 10000 truncated to 5 bytes)`);
  });

  const whisper = path.join(os.homedir(), '.cache', 'sokuji-native-tests', 'whisper-tiny-Q8_0.gguf');
  it.skipIf(!fs.existsSync(whisper))('reads the cached whisper-tiny GGUF', async () => {
    const h = await readHeader(whisper);
    expect(h.architecture).toBe('whisper');
    expect(h.tensorDtypes.has('q8_0') && h.tensorDtypes.has('f32')).toBe(true);
  });

  it('rejects a file cut off mid-KV', async () => {
    const whole = fs.readFileSync(writeGguf('toy3.gguf', 'qwen3', TOY));
    // Inside the first KV's key, its type, its value, and the second KV's array.
    for (const n of [30, 46, 52, 70, 80]) {
      const p = path.join(dir, `cut-${n}.gguf`);
      fs.writeFileSync(p, whole.subarray(0, n));
      await expect(readHeader(p), String(n)).rejects.toThrow(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: truncated or malformed GGUF header \\(`));
    }
  });

  it.each(golden.cases.map((c) => [c.name, c] as const))('matches the golden case %s', async (_name, c) => {
    const p = path.join(dir, `golden-${c.name}.gguf`);
    fs.writeFileSync(p, Buffer.from(c.bytes, 'base64'));
    const r = c.result as { architecture?: string; tensor_types?: string[]; n_tensors?: number; error?: string; message?: string };
    if (r.error) {
      const got = await readHeader(p).then(() => null, (e: unknown) => e);
      expect(got).toBeInstanceOf(GgufError);
      expect((got as Error).message).toBe(r.message!.replace('<path>', p));
    } else {
      const h = await readHeader(p);
      expect({ architecture: h.architecture, tensor_types: [...h.tensorDtypes].sort(), n_tensors: h.tensorCount }).toEqual(r);
    }
  });
});
