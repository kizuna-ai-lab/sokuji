// @vitest-environment node
/**
 * The recorded Python session (test/golden/session.json, sidecar/tools/record_session.py) replayed on the TS engine
 * running the real addon: the client's frames are sent as recorded, and every frame the engine sends back is held to
 * the Python engine's — the same message types in the same order with the same field names (strict wire check on),
 * identical transcript and translation, identical model-management answers, TTS at the same rate with its total within
 * 5 % and real signal, and the measured rtf / tokens/s within 10 % (the best of up to three runs).
 *
 *   SOKUJI_NATIVE_DIR=<the addon's directory> SOKUJI_SESSION_HF_HOME=<a cache holding the three models> \
 *   npx vitest run electron/engine/session.test.ts
 */
import './test/env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';
import session from './test/golden/session.json';
import { startEngine } from './main';
import { openWs } from './test/wsClient';

type Recorded = { dir: 'out' | 'in'; json?: Record<string, any>; binary?: string | { len: number; sha256: string; head: string } };
type Frame = { json?: Record<string, any>; binary?: Uint8Array };

const NATIVE_DIR = process.env.SOKUJI_NATIVE_DIR;
const HF_HOME = process.env.SOKUJI_SESSION_HF_HOME;

/** Every frame a socket receives, in order, read one at a time. */
function inbox(ws: WebSocket) {
  const frames: Frame[] = [];
  const waiters: Array<(f: Frame) => void> = [];
  ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
    const frame: Frame = isBinary ? { binary: new Uint8Array(buf) } : { json: JSON.parse(buf.toString('utf8')) };
    const w = waiters.shift();
    if (w) w(frame);
    else frames.push(frame);
  });
  return (timeoutMs = 300_000): Promise<Frame> => {
    const f = frames.shift();
    if (f) return Promise.resolve(f);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no frame from the engine')), timeoutMs);
      waiters.push((x) => { clearTimeout(t); resolve(x); });
    });
  };
}

interface RunResult {
  /** Where a frame differed from the recording (empty: none). */
  mismatches: string[];
  /** The measured figures: ready.rtf per socket, ready.tokensPerSec. */
  measured: Record<string, number>;
  tts: { sampleRate: number; samples: number; rms: number };
}

/** Field names; memoryBytes is a measurement the engine omits when it cannot read a positive delta, so it is not compared by name. */
const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => k !== 'memoryBytes').sort();

/**
 * The catalog with what depends on the GPUs a build can see blanked out: device memory, a GPU tier's availability,
 * whether a variant fits and which is recommended. Everything else — cards, variants, sizes, what is cached — is the
 * same on every lane.
 */
function laneFree(reply: Record<string, any>): Record<string, any> {
  const copy = JSON.parse(JSON.stringify(reply));
  for (const m of copy.models ?? []) {
    delete m.deviceMemBytes;
    for (const t of m.tiers ?? []) if (t.tier !== 'cpu') delete t.available;
    for (const v of m.variants ?? []) {
      delete v.recommended;
      delete v.supported;
      delete v.unsupportedTiers;
    }
  }
  return copy;
}

/** One full replay on a fresh engine (and a fresh bench cache, so the rates are measured). */
async function replay(sameLane: boolean): Promise<RunResult> {
  const bench = fs.mkdtempSync(path.join(os.tmpdir(), 'sokuji-session-bench-'));
  process.env.SOKUJI_BENCH_DIR = bench;
  process.env.HF_HOME = HF_HOME;
  const engine = await startEngine({ nativeDir: NATIVE_DIR!, allowedOrigins: [], log: () => {} });
  const mismatches: string[] = [];
  const measured: Record<string, number> = {};
  const pcm: Int16Array[] = [];
  let ttsRate = 0;
  try {
    const sockets = session.sockets as Array<{ name: string; frames: Recorded[] }>;
    const conns = await Promise.all(sockets.map(async () => {
      const ws = await openWs(engine.port);
      return { ws, next: inbox(ws) };
    }));
    for (let s = 0; s < sockets.length; s++) {
      const { name, frames } = sockets[s];
      const { ws, next } = conns[s];
      for (const [i, rec] of frames.entries()) {
        const where = `${name} #${i}`;
        if (rec.dir === 'out') {
          if (rec.json) ws.send(JSON.stringify(rec.json));
          else ws.send(Buffer.from(rec.binary as string, 'base64'));
          continue;
        }
        const got = await next();
        if (rec.binary !== undefined) {
          if (!got.binary) { mismatches.push(`${where}: expected a binary frame, got ${JSON.stringify(got.json)}`); continue; }
          pcm.push(new Int16Array(got.binary.slice().buffer));
          continue;
        }
        const want = rec.json!;
        if (!got.json) { mismatches.push(`${where}: expected ${want.type}, got a binary frame`); continue; }
        const m = got.json;
        if (m.type !== want.type) { mismatches.push(`${where}: type ${m.type} where Python sent ${want.type}`); continue; }
        if (keys(m).join() !== keys(want).join()) mismatches.push(`${where} ${m.type}: fields ${keys(m)} where Python sent ${keys(want)}`);
        switch (m.type) {
          case 'result':
            if (m.text !== want.text) mismatches.push(`${where}: transcript ${JSON.stringify(m.text)} ≠ ${JSON.stringify(want.text)}`);
            break;
          case 'translate_result':
            if (m.translatedText !== want.translatedText) mismatches.push(`${where}: translation ${JSON.stringify(m.translatedText)} ≠ ${JSON.stringify(want.translatedText)}`);
            break;
          case 'model_status_result':
            if (JSON.stringify(m) !== JSON.stringify(want)) mismatches.push(`${where}: ${m.type} differs from Python's`);
            break;
          case 'models_catalog_result': {
            const [a, b] = sameLane ? [m, want] : [laneFree(m), laneFree(want)];
            if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(`${where}: ${m.type} differs from Python's${sameLane ? '' : ' (GPU-dependent fields aside)'}`);
            break;
          }
          case 'ready':
            if (m.memoryBytes !== undefined && !(m.memoryBytes > 0)) mismatches.push(`${where} ready.memoryBytes: ${m.memoryBytes} is not positive`);
            if (m.rtf !== undefined) measured[`${name}.rtf`] = m.rtf;
            if (m.tokensPerSec !== undefined) measured[`${name}.tokensPerSec`] = m.tokensPerSec;
            for (const k of ['backend', 'device', 'computeType', 'sampleRate', 'streaming', 'clones', 'family']) {
              if (k in want && m[k] !== want[k]) mismatches.push(`${where} ready.${k}: ${m[k]} ≠ ${want[k]}`);
            }
            if (name === 'tts') ttsRate = m.sampleRate;
            break;
          default:
            break;
        }
      }
    }
    await Promise.all(conns.map(({ ws }) => new Promise<void>((r) => { ws.once('close', () => r()); ws.close(); })));
  } finally {
    await engine.close();
    fs.rmSync(bench, { recursive: true, force: true });
  }
  const all = pcm.reduce((n, p) => n + p.length, 0);
  let sq = 0;
  for (const p of pcm) for (const v of p) sq += (v / 32768) ** 2;
  return { mismatches, measured, tts: { sampleRate: ttsRate, samples: all, rms: all ? Math.sqrt(sq / all) : 0 } };
}

/** The recorded figures to hold the TS engine's to. */
function recorded() {
  const out: Record<string, number> = {};
  let samples = 0;
  for (const s of session.sockets as Array<{ name: string; frames: Recorded[] }>) {
    for (const f of s.frames) {
      const j = f.dir === 'in' ? f.json : undefined;
      if (j?.type === 'ready' && j.rtf !== undefined) out[`${s.name}.rtf`] = j.rtf;
      if (j?.type === 'ready' && j.tokensPerSec !== undefined) out[`${s.name}.tokensPerSec`] = j.tokensPerSec;
      if (j?.type === 'tts_done') samples = j.totalSamples;
    }
  }
  return { figures: out, ttsSamples: samples };
}

/**
 * How far each measured figure is from the recorded one (relative), lower is better. rtf is reported to three decimals
 * and is tiny on a fast CPU (0.024), so one rounding step is already 4 %: an rtf within 0.005 absolute counts as equal.
 */
const offBy = (measured: Record<string, number>, want: Record<string, number>) =>
  Object.fromEntries(Object.entries(want).map(([k, v]) => {
    if (measured[k] === undefined) return [k, Infinity];
    const abs = Math.abs(measured[k] - v);
    return [k, k.endsWith('.rtf') && abs <= 0.005 ? 0 : abs / v];
  }));

describe.skipIf(!NATIVE_DIR || !HF_HOME)('the recorded Python session on the TS engine', () => {
  it('answers as the Python engine did', async () => {
    const lane = (JSON.parse(fs.readFileSync(path.join(NATIVE_DIR!, 'contract.json'), 'utf8')) as { lane: string }).lane;
    const sameLane = lane === (session as { lane?: string }).lane;
    const want = recorded();
    const best: Record<string, number> = {};
    let last: RunResult | null = null;
    for (let run = 0; run < 3; run++) {
      last = await replay(sameLane);
      expect(last.mismatches).toEqual([]);
      expect(last.tts.sampleRate).toBe(24000);
      expect(Math.abs(last.tts.samples - want.ttsSamples) / want.ttsSamples).toBeLessThan(0.05);
      expect(last.tts.rms).toBeGreaterThan(0.01);
      for (const [k, v] of Object.entries(offBy(last.measured, want.figures))) best[k] = Math.min(best[k] ?? Infinity, v);
      if (Object.values(best).every((v) => v < 0.1)) break;
    }
    process.stdout.write(`[session] addon lane ${lane}, recorded lane ${(session as { lane?: string }).lane}${sameLane ? '' : ' (catalog compared without its GPU-dependent fields)'}\n`);
    process.stdout.write(`[session] best off-by ${JSON.stringify(best)}; last measured ${JSON.stringify(last!.measured)}; recorded ${JSON.stringify(want.figures)}; tts ${JSON.stringify(last!.tts)} vs ${want.ttsSamples}\n`);
    for (const [k, v] of Object.entries(best)) expect([k, v < 0.1]).toEqual([k, true]);
  }, 900_000);
});
