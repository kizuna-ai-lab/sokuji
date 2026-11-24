// Shared fixtures for the addon's node:test suites.
//
//   SOKUJI_NATIVE_NODE   the built sokuji_native_node.node (default: native/build/cpu/lib/)
//   SOKUJI_NATIVE_DIR    the directory holding the libraries, backend modules and
//                        contract.json (default: the addon's own directory)
//   SK_TEST_SAMPLE_WAV   jfk.wav (16 kHz mono 16-bit PCM), for jfk()
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function addonPath() {
  // resolve(): require() takes a relative path without ./ for a package name.
  const env = process.env.SOKUJI_NATIVE_NODE;
  return env ? resolve(env) : join(here, '..', '..', 'build', 'cpu', 'lib', 'sokuji_native_node.node');
}

export function loadAddon() {
  return require(addonPath());
}

export function nativeDir() {
  return process.env.SOKUJI_NATIVE_DIR || dirname(addonPath());
}

const tempDirs = [];

/** A fresh temp directory holding only `contract.json` with the given content; removed at exit. */
export function tempContractDir(contract) {
  if (tempDirs.length === 0) {
    process.once('exit', () => {
      for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
    });
  }
  const dir = mkdtempSync(join(tmpdir(), 'sokuji-contract-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'contract.json'), JSON.stringify(contract));
  return dir;
}

/** SK_TEST_SAMPLE_WAV as 16 kHz mono floats in [-1, 1). */
export function jfk() {
  const path = process.env.SK_TEST_SAMPLE_WAV;
  if (!path) throw new Error('SK_TEST_SAMPLE_WAV is not set');
  return readPcm16Mono16k(readFileSync(path), path);
}

function readPcm16Mono16k(buf, path) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  let fmt = null;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2),
              rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) {
        throw new Error(`${path}: expected 16 kHz mono 16-bit PCM, got ${JSON.stringify(fmt)}`);
      }
      const n = Math.floor(Math.min(size, buf.length - body) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(body + 2 * i) / 32768;
      return out;
    }
    off = body + size + (size & 1);   // chunks are word-aligned
  }
  throw new Error(`${path}: no data chunk`);
}

/** `pcm` cut into consecutive copies of `n` samples; the last one may be shorter. */
export function chunks(pcm, n) {
  const out = [];
  for (let i = 0; i < pcm.length; i += n) out.push(pcm.slice(i, i + n));
  return out;
}

/** A 0.5-amplitude sine of `hz` sampled at `rate`, starting at phase 0. */
export function sine(hz, rate, seconds) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

/** Signal-to-noise ratio of `a` against the reference `b`, in dB (Infinity when equal). */
export function snrDb(a, b) {
  if (a.length !== b.length) throw new RangeError(`snrDb: lengths differ (${a.length} vs ${b.length})`);
  let signal = 0;
  let noise = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    signal += b[i] * b[i];
    noise += d * d;
  }
  return 10 * Math.log10(signal / noise);
}

/** The number of threads of this process (Linux: /proc/self/task); null where that is not readable. */
export function threadCount() {
  try {
    return readdirSync('/proc/self/task').length;
  } catch {
    return null;
  }
}
