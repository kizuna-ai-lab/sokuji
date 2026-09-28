/**
 * Shared pieces of the live wire probes (`scripts/dev/wire-probe/*.mts`):
 * each probe dials a provider's real endpoint with the owner's credentials,
 * plays a recorded clip at real-time pace, and writes every frame it sees
 * — summarised, secrets redacted — so a protocol question is answered by
 * data, not by the docs. Credentials come from the environment only and
 * are never printed or written.
 *
 * Output: `.superpowers/wire-probes/<provider>/<stamp>-<run>.jsonl` (git
 * ignores `.superpowers/`), one `.wav` of the audio the provider sent per
 * run, and `report.md` beside them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Recorded speech the probes play: mono 16-bit, resampled on read. */
export const CLIPS = {
  ja: path.join(REPO, 'scripts/assets/gpt-sovits-voices/classic-ja.wav'),
  zh: path.join(REPO, 'scripts/assets/gpt-sovits-voices/classic-zh.wav'),
} as const;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function args(): { step: string | undefined; opt(name: string): string | undefined } {
  const a = process.argv.slice(2);
  return {
    step: a.find((x) => !x.startsWith('--') && a[a.indexOf(x) - 1]?.startsWith('--') !== true),
    opt: (name) => { const i = a.indexOf(`--${name}`); return i >= 0 ? a[i + 1] : undefined; },
  };
}

// ---------- audio ----------

export function readWav(file: string, rate: number): Int16Array {
  const b = fs.readFileSync(file);
  let off = 12;
  let fmt: { ch: number; rate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error(`${file}: need 16-bit PCM`);
  const frames = data.length / 2 / fmt.ch;
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = data.readInt16LE(i * 2 * fmt.ch);
  if (fmt.rate === rate) return mono;
  const outLen = Math.round((frames * rate) / fmt.rate);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = (i * fmt.rate) / rate;
    const i0 = Math.floor(x);
    const f = x - i0;
    out[i] = Math.round((mono[i0] ?? 0) * (1 - f) + (mono[i0 + 1] ?? mono[i0] ?? 0) * f);
  }
  return out;
}

export const silence = (ms: number, rate: number) => new Int16Array(Math.round((rate * ms) / 1000));

export function concat(...parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function writeWav(file: string, pcm: Int16Array, rate: number): void {
  const h = Buffer.alloc(44);
  const bytes = pcm.length * 2;
  h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(bytes, 40);
  fs.writeFileSync(file, Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, bytes)]));
}

/**
 * Sends `pcm` in `chunkMs` pieces on a drift-corrected real-time schedule,
 * as a microphone would; stops early when `closed()` says so.
 */
export async function pace(pcm: Int16Array, rate: number, chunkMs: number, send: (chunk: Int16Array) => void, closed: () => boolean): Promise<number> {
  const step = Math.round((rate * chunkMs) / 1000);
  const start = Date.now();
  let n = 0;
  for (let off = 0; off < pcm.length && !closed(); off += step) {
    send(pcm.subarray(off, off + step));
    n += 1;
    await sleep(Math.max(0, start + n * chunkMs - Date.now()));
  }
  return n;
}

// ---------- logging ----------

export interface Run {
  readonly name: string;
  readonly dir: string;
  /** Milliseconds since the run began. */
  now(): number;
  log(dir: 'in' | 'out' | 'ws' | 'rest' | 'note', type: string, detail?: unknown): void;
  /** Appends a section to the provider's `report.md` and echoes it. */
  report(markdown: string): void;
}

const secrets: string[] = [];

/** A value that must never be written: the probe's credentials, and anything minted from them. */
export function secret(value: string | undefined): string {
  const v = (value ?? '').trim();
  if (v.length >= 6 && !secrets.includes(v)) secrets.push(v);
  return v;
}

export function redact(text: string): string {
  let s = text;
  for (const v of secrets) s = s.split(v).join('<redacted>').split(encodeURIComponent(v)).join('<redacted>');
  return s
    .replace(/([?&](?:key|token|access_token|api_key)=)[^&\s"']+/gi, '$1<redacted>')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>');
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

export function startRun(provider: string, name: string, outDir?: string): Run {
  const dir = outDir ?? path.join(REPO, '.superpowers/wire-probes', provider);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${STAMP}-${name}.jsonl`);
  const t0 = Date.now();
  return {
    name,
    dir,
    now: () => Date.now() - t0,
    log(d, type, detail) {
      const line: Record<string, unknown> = { t: Date.now() - t0, dir: d, type };
      if (detail !== undefined) line.d = JSON.parse(redact(JSON.stringify(detail)));
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    },
    report(markdown) {
      const text = redact(markdown);
      fs.appendFileSync(path.join(dir, 'report.md'), `\n## ${STAMP} ${name}\n\n${text}\n`);
      console.log(`\n## ${name}\n${text}`);
    },
  };
}

export const stamp = () => STAMP;
