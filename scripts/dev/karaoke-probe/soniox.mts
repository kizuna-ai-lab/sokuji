/**
 * Karaoke timing probe, Soniox (own key): runs the app's own Soniox adapter
 * — STT + translation on one socket, TTS on the other — against the real
 * service, feeding recorded speech at real-time pace, and logs what the
 * karaoke has to work with: every adapter event with its arrival time, and
 * every TTS frame (which text went into which stream, which audio came back)
 * through a wrapped socket. The output audio, in arrival order, is saved as
 * one wav for word timestamps.
 *
 *   SONIOX_API_KEY_FILE=path npx tsx scripts/dev/karaoke-probe/soniox.mts <run> [--region jp] [--out dir]
 *
 * Runs: ja-en, ja-zh (the eight assets/ja sentences), zhja-en (classic-zh,
 * classic-ja), zh-ja (classic-zh). Each is its clip with 1.5 s pauses, then
 * silence until the TTS has been quiet for 5 s.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createSonioxAdapter } from '../../../src/providers/soniox/adapter';
import { SONIOX_STT_MODEL } from '../../../src/providers/soniox/sttStream';
import { SONIOX_DEFAULT_VOICE } from '../../../src/lib/soniox/ttsCatalog';
import { realClock } from '../../../src/lib/contract/clock';
import { SAMPLE_RATE, type AdapterEvents } from '../../../src/lib/contract/adapter';
import type { SonioxRegion } from '../../../src/lib/soniox/regions';
import { CLIPS, REPO, args, concat, readWav, silence, sleep, writeWav } from '../wire-probe/common.mts';

const JA = ['meeting', 'train', 'cafe', 'umbrella', 'book', 'dinner', 'door', 'wait'].map((n) => path.join(REPO, `scripts/dev/wire-probe/assets/ja/${n}.wav`));
const RUNS: Record<string, { source: string; target: string; clips: string[] }> = {
  'ja-en': { source: 'ja', target: 'en', clips: JA },
  'ja-zh': { source: 'ja', target: 'zh', clips: JA },
  'zhja-en': { source: 'zh', target: 'en', clips: [CLIPS.zh, CLIPS.ja] },
  'zh-ja': { source: 'zh', target: 'ja', clips: [CLIPS.zh] },
};

const a = args();
const name = a.step ?? '';
const run = RUNS[name];
if (!run) throw new Error(`run one of: ${Object.keys(RUNS).join(', ')}`);
const keyFile = process.env.SONIOX_API_KEY_FILE;
const key = (keyFile ? fs.readFileSync(keyFile, 'utf8') : process.env.SONIOX_API_KEY ?? '').trim();
if (!key) throw new Error('SONIOX_API_KEY_FILE or SONIOX_API_KEY');
const region = (a.opt('region') ?? 'jp') as SonioxRegion;
const outDir = a.opt('out') ?? path.join(REPO, '.superpowers/karaoke-probe/soniox');
fs.mkdirSync(outDir, { recursive: true });

const t0 = performance.now();
const now = () => Math.round((performance.now() - t0) * 10) / 10;
const lines: string[] = [];
const log = (kind: string, d: unknown) => lines.push(JSON.stringify({ t: now(), kind, d }));
const redact = (s: string) => s.split(key).join('<key>');
const out: Int16Array[] = [];

// Every TTS frame, both ways: the text each stream was fed, and the audio it sent back.
function openSocket(url: string, protocols: string[]): WebSocket {
  const ws = new WebSocket(url, protocols);
  const tts = url.includes('tts-rt');
  const send = ws.send.bind(ws);
  ws.send = (data: Parameters<WebSocket['send']>[0]) => {
    if (tts && typeof data === 'string') {
      const m = JSON.parse(data) as Record<string, unknown>;
      log('tts.out', { stream: m.stream_id, text: m.text, end: m.text_end, config: m.voice !== undefined ? { voice: m.voice, language: m.language } : undefined, keepalive: m.keep_alive });
    }
    send(data);
  };
  if (tts) {
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      const m = JSON.parse(ev.data) as Record<string, unknown>;
      const samples = typeof m.audio === 'string' ? Buffer.from(m.audio, 'base64').length / 2 : 0;
      log('tts.in', { stream: m.stream_id, samples, terminated: m.terminated, audioEnd: m.audio_end, error: m.error_code ?? m.error_message });
    });
  }
  log('socket', { host: new URL(url).host, tts });
  return ws;
}

const events = new Proxy({} as AdapterEvents, {
  get: (_t, kind: string) => (e: Record<string, unknown> | boolean | undefined) => {
    if (kind === 'audio') {
      const { pcm, ...rest } = e as { pcm: Int16Array };
      out.push(pcm);
      log('audio', { ...rest, samples: pcm.length });
      return;
    }
    if (kind === 'frame') {
      const f = e as { type: string; direction: string; payload?: unknown };
      if (f.type === 'tts.audio') return;
      log('frame', { dir: f.direction, type: f.type, payload: f.payload === undefined ? undefined : JSON.parse(redact(JSON.stringify(f.payload))) });
      return;
    }
    log(kind, e && typeof e === 'object' && 'cause' in e ? { ...e, cause: String((e as { cause: unknown }).cause) } : e);
  },
});

const context = { direction: { source: run.source, target: run.target }, speech: true, turns: 'auto' as const };
const config = {
  stt: { model: SONIOX_STT_MODEL, endpointSensitivity: 0, endpointLatencyAdjustmentLevel: 0, endpointMaxDelayMs: 2000 },
  tts: { voice: SONIOX_DEFAULT_VOICE, speed: 1.0 },
  sharedBoth: false,
  diarize: false,
};
log('run', { name, region, context, config });

const session = await createSonioxAdapter({ openSocket }).start(
  { context, config, credentials: { region, stt: key, tts: key }, clock: realClock, signal: new AbortController().signal },
  events,
);
log('started', session.info);

const pause = silence(1500, SAMPLE_RATE);
const input = concat(silence(500, SAMPLE_RATE), ...run.clips.flatMap((c) => [readWav(c, SAMPLE_RATE), pause]));
const frame = SAMPLE_RATE / 10;
const start = performance.now();
for (let i = 0; i < input.length; i += frame) {
  session.appendAudio(input.subarray(i, i + frame));
  const due = start + ((i + frame) / SAMPLE_RATE) * 1000;
  await sleep(Math.max(0, due - performance.now()));
}
log('input.end', { seconds: input.length / SAMPLE_RATE });
// Silence for at least 8 s, then until the speech has been quiet for 5 s (60 s at most): the last sentence's TTS finishes.
const quiet = silence(100, SAMPLE_RATE);
const inputEnd = now();
const deadline = inputEnd + 60_000;
const lastAudio = () => { for (let i = lines.length - 1; i >= 0; i--) if (lines[i].includes('"kind":"audio"')) return JSON.parse(lines[i]).t as number; return 0; };
while (now() < deadline && (now() - inputEnd < 8000 || now() - lastAudio() < 5000)) {
  session.appendAudio(quiet);
  await sleep(100);
}
await session.stop();
log('stopped', {});

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.writeFileSync(path.join(outDir, `${stamp}-${name}.jsonl`), lines.join('\n') + '\n');
writeWav(path.join(outDir, `${stamp}-${name}.out.wav`), concat(...out), SAMPLE_RATE);
writeWav(path.join(outDir, `${stamp}-${name}.in.wav`), input, SAMPLE_RATE);
const n = (k: string) => lines.filter((l) => l.includes(`"kind":"${k}"`)).length;
console.log(`${name}: ${n('audio')} audio, ${n('speechRanges')} speechRanges, ${n('segmentText')} texts, ${(out.reduce((s, p) => s + p.length, 0) / SAMPLE_RATE).toFixed(1)} s out → ${stamp}-${name}.*`);
process.exit(0);
