/**
 * OpenAI Live (`gpt-live-1`, `wss://api.openai.com/v1/live/sessions`): the Stage 2 port's open protocol
 * questions (the survey's U1–U12), answered by data. Node `ws` with a real `Authorization: Bearer` header
 * and no `Origin`, as the app's header seam will send it. Every frame is logged to `<stamp>-<run>.jsonl`
 * (audio replaced by `{ samples, rms, off, …its other fields }`), the output audio is saved raw to
 * `<stamp>-<run>.out.pcm` (24 kHz PCM16, every frame in arrival order), the input to `.in.wav`, and each
 * mode ends with a verdict block in `report.md`: the measured numbers, then one line per question
 * ("U4: …") with the conclusion the numbers support and the threshold it used.
 *
 *   OPENAI_API_KEY=… npx tsx scripts/dev/wire-probe/live.mts <mode> [options]
 *
 * Modes, and the paid Live time each costs with the default clip ($0.05/min, billed per second,
 * silence included). The default clip is openai-translate.mts's `user` script: six synthesised Chinese
 * sentences with the owner's pauses, 47.4 s. All eight of that probe's sentences (mute uses the last
 * two) are already in the TTS cache it keeps, so a run makes no TTS call.
 *   headers   U9   three upgrades that must be refused (with Origin; subprotocol only; bogus Bearer),
 *                  then one good session: session.start → session.started → session.close  ≈ 0.05 min
 *   timeline  U4 U5 U8 U12  1 s with no appends (so the input stamps' clock shows), the clip,
 *                  then 15 s of silence, at real-time pace                                 ≈ 1.1 min
 *                  + whisper-1 on the voiced output (≈ 0.7 min at $0.006/min)
 *   release   U1   the clip, 20 s with no appends at all, 10 s of paced silence               ≈ 1.3 min
 *   mute      U2   three sentences, session.input_audio.mute, 20 s (a fourth sentence, then silence,
 *                  appended while muted), unmute, a fifth sentence, 10 s of silence            ≈ 1.0 min
 *   idle      U3   session.start and no appends, until --max (180 s) or a server close          ≤ 3.0 min
 *   close     U7   two sentences, then session.close at once                                  ≈ 0.35 min
 *   errors    U10  an invalid voice at session.start (refused: free); malformed appends mid-session ≈ 0.5 min
 *   both      U11  two sessions on the one key, the same two sentences into each              ≈ 2 × 0.5 min
 *   all            headers, timeline, release, close, errors, both in turn (not idle or mute)  ≈ 4.3 min ≈ $0.22
 *
 * Options:
 *   --clip zh|ja          zh (default): the synthesised Chinese sentences (OpenAI TTS, cached under
 *                         .superpowers/wire-probes/openai-translate/tts/, fetched once when missing);
 *                         ja: scripts/dev/wire-probe/assets/ja/*.wav, eight sentences, 34.4 s
 *   --script user|tight|long   the zh script (default user)
 *   --sentences N         only the first N sentences of the timeline/release clip
 *   --target en           the translation's language (default en). The per-sentence keyword maps that
 *                         pair each source sentence with its translation are English: another target
 *                         leaves those columns unmeasured
 *   --voice marin         --delegation client|null (timeline: U12; run both, the report compares them)
 *   --max 180             idle: seconds to wait for a server close
 *   --pause 1500          the silence the pairing simulations cut on (U5)
 *   --out <dir>           default .superpowers/wire-probes/openai-live/
 *   --url <ws url>        default wss://api.openai.com/v1/live/sessions; any other host must be loopback
 *
 * Offline proof only: `--offline --url ws://127.0.0.1:<port>/v1/live/sessions[?scenario]` dials a local
 * stand-in (refused for any other host) with a dummy key, never calls TTS (a cached sentence or the ja
 * assets only) or whisper-1 (`--words <file|dir>`: canned word timestamps, a dir holding one
 * `<session id>.json` per session), and writes under .superpowers/wire-probes/openai-live-fake/.
 *
 * Credentials come from the environment only and are never printed or written.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { Segment } from '../../../src/lib/conversation/types';
import { DEFAULT_PAIRING, inferPairs } from '../../../src/lib/projection/pair';
import { INSTRUCTIONS_DEFAULTS, resolveInstructions } from '../../../src/lib/provider/instructions';
import { LEADING_PUNCT_RE, lastClauseEnd, lastSentenceEnd, sentenceEnds } from '../../../src/lib/segmentation/sentenceEnd';
import { REPO, concat, pace, readWav, secret, silence, sleep, startRun, stamp, writeWav, type Run } from './common.mts';

const RATE = 24_000;
const LIVE_URL = 'wss://api.openai.com/v1/live/sessions';
const MODEL = 'gpt-live-1';
const CHUNK_MS = 100;
/** The old client's OUTPUT_SILENCE_RMS: Live's between-utterance frames are a dithered floor, not zero. */
const FLOOR_RMS = 0.002;
const START_TIMEOUT_MS = 30_000;
const CLOSE_WAIT_MS = 10_000;
const PRICE_PER_MIN = 0.05;
const OFFLINE_KEY = 'sk-offline-live-probe-key';
const TTS_DIR = path.join(REPO, '.superpowers/wire-probes/openai-translate/tts');
const JA_DIR = path.join(REPO, 'scripts/dev/wire-probe/assets/ja');
const IN_T = 'session.input_transcript.delta';
const OUT_T = 'session.output_transcript.delta';
const OUT_A = 'session.output_audio.delta';
// The old client's segmentation constants (OpenAILiveClient.ts:62-74), for the U5 simulation.
const USER_TIMELINE_GAP_MS = 600;
const USER_MIN_SPAN_MS = 4_000;
const USER_SOFT_CAP_MS = 8_000;
const USER_SPAN_CAP_MS = 12_000;
const ASSISTANT_SOFT_CAP_MS = 20_000;
const ASSISTANT_SPAN_CAP_MS = 30_000;
const AUDIO_HANDOFF_MARGIN_MS = 300;
/** openai-translate.mts's proposed rule: a translation that stops mid-sentence is held this long. */
const MID_HOLD_MS = 5_000;
/** L2's proximity window (src/lib/projection/pair.ts). */
const PROXIMITY_MS = DEFAULT_PAIRING.proximityMs;

// ---------- options ----------

const BOOLEAN_FLAGS = new Set(['offline']);
const flags: Record<string, string | true> = {};
const positional: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const name = a.slice(2);
  if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
  else { flags[name] = process.argv[i + 1] ?? ''; i++; }
}
const opt = (name: string, dflt: string): string => (typeof flags[name] === 'string' ? (flags[name] as string) : dflt);
const mode = positional[0] ?? '';
const offline = flags.offline === true;
const url = opt('url', LIVE_URL);
const host = new URL(url).hostname;
const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host);
if (!loopback && host !== 'api.openai.com') {
  console.error(`--url must be api.openai.com or a loopback address: the key is sent to it (got ${host}).`);
  process.exit(2);
}
if (offline && !loopback) {
  console.error('--offline dials only a loopback stand-in (--url ws://127.0.0.1:<port>/…).');
  process.exit(2);
}
const key = secret(offline ? OFFLINE_KEY : process.env.OPENAI_API_KEY);
if (!key) {
  console.error('Set OPENAI_API_KEY (or pass --offline with a loopback --url).');
  process.exit(2);
}
const clipKind = opt('clip', offline ? 'ja' : 'zh');
if (clipKind !== 'zh' && clipKind !== 'ja') { console.error('--clip is zh or ja'); process.exit(2); }
const scriptName = opt('script', 'user');
const sentenceLimit = Number(opt('sentences', '0')) || Infinity;
const target = opt('target', 'en');
const voice = opt('voice', 'marin');
const delegation = opt('delegation', 'client') === 'null' ? 'null' : 'client';
const idleMaxMs = Number(opt('max', '180')) * 1000;
const pauseMs = Number(opt('pause', '1500'));
const PROVIDER = offline ? 'openai-live-fake' : 'openai-live';
const outDir = opt('out', path.join(REPO, '.superpowers/wire-probes', PROVIDER));
fs.mkdirSync(outDir, { recursive: true });
/** The per-sentence translation keywords are English. */
const saidOk = /^en([-_]|$)/i.test(target);

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian', ru: 'Russian',
};
const languageName = (code: string) => LANGUAGE_NAMES[code.slice(0, 2).toLowerCase()] ?? code;
const instructions = resolveInstructions(INSTRUCTIONS_DEFAULTS, { participant: false, source: languageName(clipKind), target: languageName(target) });

// ---------- speech ----------

interface Sentence {
  text: string;
  /** Its words in Live's input transcript, and in an English translation: how a segment is told apart. */
  heard: RegExp;
  said: RegExp;
  file?: string;
}

/** openai-translate.mts's sentences (the same TTS cache), with a keyword each side. */
const ZH: Record<string, Sentence> = {
  a: { text: '今天我吃了一家不错的牛肉面，老板好像是四川人，反正肯定不是日本人。', heard: /牛肉[面麵]|四川/, said: /noodle|sichuan|szechuan/i },
  b: { text: '店里的装修不错，一个吧台铺满了辣椒，店里的海报也贴得很好，不是随便贴贴的。', heard: /[装裝]修|吧台|辣椒|海[报報]/, said: /decor|counter|\bbar\b|chil[li]|pepper|poster/i },
  c: { text: '看起来十分用心。', heard: /用心/, said: /thought|\bcare|effort|attentive|dedicat|meticulous|attention/i },
  d: { text: '下午快接近吃饭的时间有三四个客人，就老板一个人也忙活得过来。', heard: /客人|忙活|吃[饭飯]/, said: /afternoon|customers|three or four|busy|handle|manage/i },
  e: { text: '排骨有点薄，但是炸的面衣不错，适合泡在汤里吃。', heard: /排骨|[面麵]衣|[汤湯]/, said: /\bribs?\b|pork|cutlet|batter|coating|breading|soup|broth/i },
  f: { text: '店里的贩卖机竟然不支持新的一千和五百日元。', heard: /[贩販][卖賣]机|[贩販][卖賣]機|售[货貨]|日元|日[圆圓]/, said: /vending|machine|\byen\b|thousand|hundred/i },
  g: { text: '吃完以后我在附近的公园走了一会儿。', heard: /公[园園]/, said: /\bpark\b|\bwalk/i },
  h: { text: '天气有点冷，但是空气很好。', heard: /天[气氣]|空[气氣]/, said: /weather|\bcold\b|\bair\b/i },
};

/** The eight Japanese sentences of scripts/dev/wire-probe/assets/ja (texts from gemini-multi.mts). */
const JA: Record<string, Sentence> = {
  umbrella: { text: '今日は雨が降りそうなので、傘を持っていきます。', heard: /傘/, said: /umbrella/i, file: 'umbrella' },
  door: { text: 'ドアを閉めてください。', heard: /ドア|扉/, said: /\bdoor/i, file: 'door' },
  meeting: { text: '明日の会議は午後三時に始まります。', heard: /会議/, said: /meeting/i, file: 'meeting' },
  book: { text: 'この本はとても面白かったです。', heard: /本/, said: /\bbook/i, file: 'book' },
  dinner: { text: '週末に家族と一緒に夕食を食べました。', heard: /夕食|夕飯|晩ご飯/, said: /dinner|supper/i, file: 'dinner' },
  cafe: { text: '駅の近くに新しいカフェができました。', heard: /カフェ/, said: /caf[eé]|coffee/i, file: 'cafe' },
  train: { text: '電車が十分遅れています。', heard: /電車/, said: /\btrain/i, file: 'train' },
  wait: { text: '少々お待ちください。', heard: /待/, said: /\bwait|moment/i, file: 'wait' },
};

/** Sentence ids and pauses (ms), in order. */
type Script = Array<string | number>;
const ZH_SCRIPTS: Record<string, Script> = {
  user: [500, 'a', 2400, 'b', 400, 'c', 2200, 'd', 1800, 'e', 1400, 'f'],
  tight: [500, 'a', 1700, 'b', 1700, 'c', 1700, 'd', 1700, 'e', 1700, 'f'],
  long: [500, 'a', 2400, 'b', 400, 'c', 2200, 'd', 1800, 'e', 1400, 'f', 2000, 'g', 900, 'h'],
};
/** The `long` script's pauses over the eight Japanese sentences. */
const JA_SCRIPT: Script = [500, 'umbrella', 2400, 'door', 400, 'meeting', 2200, 'book', 1800, 'dinner', 1400, 'cafe', 2000, 'train', 900, 'wait'];

const SENTENCES = clipKind === 'ja' ? JA : ZH;

function firstSentences(script: Script, n: number): Script {
  const out: Script = [];
  let seen = 0;
  for (const p of script) {
    if (typeof p === 'string') { if (seen >= n) break; seen++; }
    out.push(p);
  }
  return out;
}

function scripts(): { main: Script; short: Script; muteA: Script; muteM: Script; muteB: Script } {
  const full = clipKind === 'ja' ? JA_SCRIPT : ZH_SCRIPTS[scriptName];
  if (!full) throw new Error(`no zh script ${scriptName}`);
  return clipKind === 'ja'
    ? { main: firstSentences(full, sentenceLimit), short: firstSentences(full, 2), muteA: [500, 'umbrella', 2400, 'door', 400, 'meeting'], muteM: ['cafe'], muteB: ['train'] }
    : { main: firstSentences(full, sentenceLimit), short: firstSentences(full, 2), muteA: [500, 'a', 2400, 'b', 400, 'c'], muteM: ['g'], muteB: ['h'] };
}
const clipLabel = clipKind === 'ja' ? 'ja (assets/ja)' : `zh ${scriptName} (synthesised)`;

async function tts(text: string): Promise<Int16Array> {
  const file = path.join(TTS_DIR, `${crypto.createHash('sha1').update(text).digest('hex')}.pcm`);
  if (!fs.existsSync(file)) {
    if (offline) throw new Error(`offline: no cached TTS for “${text}” (${file}); use --clip ja`);
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm', instructions: 'Speak natural Mandarin Chinese at a normal conversational pace.' }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
    fs.mkdirSync(TTS_DIR, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return int16(fs.readFileSync(file));
}

interface Mark { id: string; text: string; heard: RegExp; said: RegExp; startMs: number; endMs: number }
interface Clip { pcm: Int16Array; marks: Mark[]; ms: number }

async function build(script: Script): Promise<Clip> {
  const parts: Int16Array[] = [];
  const marks: Mark[] = [];
  let at = 0;
  for (const p of script) {
    if (typeof p === 'number') { parts.push(silence(p, RATE)); at += p; continue; }
    const s = SENTENCES[p];
    if (!s) throw new Error(`no sentence ${p}`);
    const pcm = s.file ? readWav(path.join(JA_DIR, `${s.file}.wav`), RATE) : await tts(s.text);
    parts.push(pcm);
    const ms = (pcm.length / RATE) * 1000;
    marks.push({ id: p, text: s.text, heard: s.heard, said: s.said, startMs: Math.round(at), endMs: Math.round(at + ms) });
    at += ms;
  }
  return { pcm: concat(...parts), marks, ms: Math.round(at) };
}

// ---------- small helpers ----------

function int16(b: Buffer): Int16Array {
  const copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2));
  return new Int16Array(copy);
}
function rmsOf(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / pcm.length) / 32768;
}
const b64 = (pcm: Int16Array) => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const median = (xs: number[]) => quantile(xs, 0.5);
const ms = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x)} ms`);
const sec = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x / 1000).toFixed(2)} s`);
const words = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length > 0;
const clip1 = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);
const dollars = (seconds: number) => `$${((seconds / 60) * PRICE_PER_MIN).toFixed(3)}`;
function globalRe(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
}
function lastMatch(re: RegExp, text: string): number {
  let at = -1;
  for (const m of text.matchAll(globalRe(re))) at = m.index ?? at;
  return at;
}
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** Words, lower-cased, punctuation dropped; CJK text one character per word. */
function norm(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ').trim().split(/\s+/).filter(Boolean)
    .flatMap((w) => (CJK.test(w) ? [...w].filter((c) => /[\p{L}\p{N}]/u.test(c)) : [w.replace(/^'+|'+$/g, '')]))
    .filter(Boolean);
}
/** The longest common subsequence of two word lists, as index pairs. */
function lcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++; else j++;
  }
  return out;
}

// ---------- the session ----------

interface Rec {
  /** Run time of arrival (ms). */
  t: number;
  type: string;
  /** Every field but an audio frame's `delta`. */
  e: Record<string, unknown>;
  audio?: { off: number; samples: number; rms: number };
}

class LiveSession {
  readonly recs: Rec[] = [];
  readonly outChunks: Buffer[] = [];
  outSamples = 0;
  readonly inputs: Array<{ t: number; samples: number; rms: number }> = [];
  startedAt: number | null = null;
  startedWall: number | null = null;
  started: Record<string, unknown> | null = null;
  closeSentAt: number | null = null;
  sock: { t: number; code: number; reason: string } | null = null;
  refused: { status: number; body: string } | null = null;
  openedAt: number | null = null;
  readonly done: Promise<void>;
  private finish!: () => void;
  private finished = false;
  private readonly ws: WebSocket;
  private readonly waiters = new Set<{ pred: (r: Rec) => boolean; resolve: (r: Rec | null) => void }>();
  private fd: number | null;

  constructor(private readonly run: Run, readonly leg: string | undefined, o: { headers: Record<string, string>; protocols?: string[]; pcmFile?: string }) {
    this.done = new Promise<void>((r) => { this.finish = r; });
    this.fd = o.pcmFile ? fs.openSync(o.pcmFile, 'w') : null;
    this.log('ws', 'dial', { host, path: new URL(url).pathname, headers: Object.keys(o.headers), protocols: (o.protocols ?? []).map((p) => (p.includes(key) ? '<with key>' : p)) });
    this.ws = new WebSocket(url, o.protocols ?? [], { headers: o.headers });
    this.ws.on('open', () => { this.openedAt = this.run.now(); this.log('ws', 'open'); });
    this.ws.on('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d: Buffer) => { body += String(d); });
      res.on('end', () => {
        this.refused = { status: res.statusCode ?? 0, body };
        this.log('ws', 'unexpected-response', { status: res.statusCode, body: body.slice(0, 2000) });
        try { req.destroy(); } catch { /* gone */ }
        this.end();
      });
    });
    this.ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => this.onMessage(data, isBinary));
    this.ws.on('close', (code: number, reason: Buffer) => {
      this.sock = { t: this.run.now(), code, reason: String(reason) };
      this.log('ws', 'close', { code, reason: String(reason) });
      this.end();
    });
    this.ws.on('error', (err: Error) => this.log('ws', 'error', { message: err.message }));
  }

  private log(dir: 'in' | 'out' | 'ws' | 'note', type: string, d?: Record<string, unknown>): void {
    this.run.log(dir, type, this.leg ? { leg: this.leg, ...(d ?? {}) } : d);
  }

  private end(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.fd !== null) { fs.closeSync(this.fd); this.fd = null; }
    for (const w of [...this.waiters]) w.resolve(null);
    this.finish();
  }

  private onMessage(data: WebSocket.RawData, isBinary: boolean): void {
    const t = this.run.now();
    if (isBinary) { this.log('in', 'binary', { bytes: Buffer.isBuffer(data) ? data.length : null }); return; }
    let e: Record<string, unknown>;
    try { e = obj(JSON.parse(String(data))); } catch { this.log('in', 'unparsable', { text: String(data).slice(0, 300) }); return; }
    const type = typeof e.type === 'string' ? e.type : 'unknown';
    let rec: Rec;
    if (type === OUT_A && typeof e.delta === 'string') {
      const b = Buffer.from(e.delta, 'base64');
      const pcm = int16(b);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e)) if (k !== 'delta' && k !== 'type') rest[k] = v;
      const audio = { off: this.outSamples, samples: pcm.length, rms: Math.round(rmsOf(pcm) * 1e6) / 1e6 };
      this.outChunks.push(b);
      this.outSamples += pcm.length;
      if (this.fd !== null) fs.writeSync(this.fd, b);
      rec = { t, type, e: rest, audio };
      this.log('in', type, { ...audio, ...rest });
    } else {
      rec = { t, type, e };
      this.log('in', type, e);
    }
    if (type === 'session.started' && this.startedAt === null) {
      this.startedAt = t;
      this.startedWall = Date.now();
      this.started = obj(e.session);
    }
    this.recs.push(rec);
    for (const w of [...this.waiters]) if (w.pred(rec)) w.resolve(rec);
  }

  isOpen(): boolean { return this.ws.readyState === WebSocket.OPEN; }

  waitOpen(timeoutMs: number): Promise<boolean> {
    if (this.openedAt !== null) return Promise.resolve(true);
    if (this.finished) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this.ws.once('open', () => { clearTimeout(timer); resolve(true); });
      void this.done.then(() => { clearTimeout(timer); resolve(this.openedAt !== null); });
    });
  }

  /** The first record from `since` on that `pred` accepts, or null at the timeout or the socket's end. */
  waitFor(pred: (r: Rec) => boolean, timeoutMs: number, since = 0): Promise<Rec | null> {
    for (let i = since; i < this.recs.length; i++) if (pred(this.recs[i])) return Promise.resolve(this.recs[i]);
    if (this.finished) return Promise.resolve(null);
    return new Promise((resolve) => {
      const w = {
        pred,
        resolve: (r: Rec | null) => { clearTimeout(timer); this.waiters.delete(w); resolve(r); },
      };
      const timer = setTimeout(() => w.resolve(null), timeoutMs);
      this.waiters.add(w);
    });
  }

  /** Waits `timeoutMs`, or less if the socket ends. */
  async idle(timeoutMs: number): Promise<void> {
    await Promise.race([sleep(timeoutMs), this.done]);
  }

  send(frame: Record<string, unknown>, logAs?: Record<string, unknown>): boolean {
    if (!this.isOpen()) return false;
    this.ws.send(JSON.stringify(frame));
    this.log('out', String(frame.type), logAs ?? frame);
    return true;
  }

  append(pcm: Int16Array): void {
    const rms = Math.round(rmsOf(pcm) * 1e6) / 1e6;
    if (this.send({ type: 'session.input_audio.append', audio: b64(pcm) }, { samples: pcm.length, rms })) {
      this.inputs.push({ t: this.run.now(), samples: pcm.length, rms });
    }
  }

  async start(frame: Record<string, unknown>): Promise<{ outcome: 'started' | 'error' | 'closed' | 'timeout'; rec: Rec | null; ms: number }> {
    const t0 = this.run.now();
    const since = this.recs.length;
    this.send(frame);
    const r = await this.waitFor((x) => x.type === 'session.started' || x.type === 'error' || x.type === 'session.closed', START_TIMEOUT_MS, since);
    const took = this.run.now() - t0;
    if (r) return { outcome: r.type === 'session.started' ? 'started' : r.type === 'error' ? 'error' : 'closed', rec: r, ms: took };
    return { outcome: this.finished ? 'closed' : 'timeout', rec: null, ms: took };
  }

  closedFrame(): Rec | null { return this.recs.find((r) => r.type === 'session.closed') ?? null; }

  /** session.close (when open and not already closed), up to CLOSE_WAIT_MS for session.closed, then the socket. */
  async close(): Promise<{ sentAt: number | null; closed: Rec | null; took: number | null }> {
    let closed = this.closedFrame();
    let sentAt: number | null = null;
    if (this.isOpen() && !closed) {
      sentAt = this.run.now();
      this.closeSentAt = sentAt;
      const since = this.recs.length;
      this.send({ type: 'session.close' });
      closed = await this.waitFor((r) => r.type === 'session.closed', CLOSE_WAIT_MS, since);
    }
    if (!this.finished) {
      try { this.ws.close(1000); } catch { /* not open */ }
      await Promise.race([this.done, sleep(3000)]);
      if (!this.finished) { this.ws.terminate(); await Promise.race([this.done, sleep(1000)]); }
    }
    this.end();
    return { sentAt, closed, took: closed && sentAt !== null ? closed.t - sentAt : null };
  }

  terminate(): void { this.ws.terminate(); }
}

function sessionStart(o: { voice?: string; delegation?: 'client' | 'null' } = {}): Record<string, unknown> {
  return {
    type: 'session.start',
    event_id: 'start_1',
    session: {
      model: MODEL,
      instructions,
      audio: { format: { type: 'audio/pcm', rate: RATE }, output: { voice: o.voice ?? voice } },
      delegation: (o.delegation ?? delegation) === 'null' ? null : { type: 'client' },
    },
  };
}

function dial(run: Run, name: string, o: { headers?: Record<string, string>; protocols?: string[]; leg?: string; pcm?: boolean } = {}): LiveSession {
  const pcmFile = o.pcm === false ? undefined : path.join(outDir, `${stamp()}-${name}${o.leg ? `.${o.leg}` : ''}.out.pcm`);
  return new LiveSession(run, o.leg, { headers: o.headers ?? { Authorization: `Bearer ${key}` }, protocols: o.protocols, pcmFile });
}

/** A session that reached session.started, or an Error that says why not. */
async function startedSession(run: Run, name: string, frame = sessionStart(), leg?: string): Promise<LiveSession> {
  const s = dial(run, name, { leg });
  if (!(await s.waitOpen(15_000))) {
    throw new Error(`upgrade refused: ${s.refused ? `${s.refused.status} ${s.refused.body.slice(0, 300)}` : s.sock ? `closed ${s.sock.code}` : 'timeout'}`);
  }
  const r = await s.start(frame);
  if (r.outcome !== 'started') {
    await s.close();
    throw new Error(`session.start → ${r.outcome}${r.rec ? `: ${JSON.stringify(r.rec.e).slice(0, 400)}` : ''}`);
  }
  return s;
}

async function paceInto(ss: LiveSession[], pcm: Int16Array): Promise<void> {
  await pace(pcm, RATE, CHUNK_MS, (c) => { for (const s of ss) s.append(c); }, () => ss.every((s) => !s.isOpen()));
}

// ---------- reading a session back ----------

interface Delta { t: number; delta: string; start: number | null; end: number | null }
const deltasOf = (s: LiveSession, type: string): Delta[] =>
  s.recs.filter((r) => r.type === type && typeof r.e.delta === 'string').map((r) => ({ t: r.t, delta: String(r.e.delta), start: num(r.e.start_ms), end: num(r.e.end_ms) }));
const usageOf = (s: LiveSession) =>
  s.recs.filter((r) => r.type === 'session.usage.updated').map((r) => ({ t: r.t, seconds: num(obj(r.e.usage).seconds) }));
const textOf = (ds: Delta[], from = -Infinity, to = Infinity) => ds.filter((d) => d.t > from && d.t <= to).map((d) => d.delta).join('');
const errorsOf = (s: LiveSession) => s.recs.filter((r) => r.type === 'error');
function errorLine(r: Rec): string {
  const e = obj(r.e.error);
  const fields = ['type', 'code', 'param', 'message', 'event_id'].filter((k) => e[k] !== undefined).map((k) => `${k}: ${JSON.stringify(e[k])}`);
  const top = Object.keys(r.e).filter((k) => k !== 'type' && k !== 'error');
  return `{ ${fields.join(', ')} }${top.length ? ` (also ${top.map((k) => `${k}: ${JSON.stringify(r.e[k])}`).join(', ')})` : ''}`;
}
/** The billed seconds at the end: session.closed's usage, else the last usage.updated. */
function billed(s: LiveSession): number | null {
  const c = s.closedFrame();
  const fromClose = c ? num(obj(c.e.usage).seconds) : null;
  return fromClose ?? usageOf(s).map((u) => u.seconds).filter((x): x is number => x !== null).at(-1) ?? null;
}
function costLine(s: LiveSession): string {
  const end = s.closedFrame()?.t ?? s.sock?.t ?? null;
  const wall = s.startedAt !== null && end !== null ? end - s.startedAt : null;
  const b = billed(s);
  return `Live time: session.started → end ${sec(wall)}; billed seconds reported ${b ?? '—'}${b !== null ? ` (≈ ${dollars(b)})` : wall !== null ? ` (≈ ${dollars(wall / 1000)} by wall clock)` : ''}`;
}

interface Continuity {
  frames: number; floor: number; voiced: number; audioMs: number; voicedMs: number; wallMs: number;
  firstAfterStart: number | null; lagMin: number; lagMax: number; lagEnd: number; maxGap: number; gaps500: number;
  fields: string; fieldNames: string[]; floorRmsMax: number; voicedRmsMin: number; continuous: boolean;
}

/**
 * Whether the output audio is one continuous real-time stream: each frame's arrival against where its
 * first sample sits on the stream's own clock (samples ÷ 24 from the first frame). A stream that pauses
 * between utterances falls behind real time (the lag grows past 1 s); one that bursts ahead (a negative
 * lag) still keeps its sample count as a timeline.
 */
function continuity(s: LiveSession, from = -Infinity, to = Infinity): Continuity | null {
  const fr = s.recs.filter((r) => r.audio && r.t >= from && r.t <= to);
  if (!fr.length) return null;
  const first = fr[0];
  const lags = fr.map((r) => r.t - (first.t + (r.audio!.off - first.audio!.off) / (RATE / 1000)));
  let maxGap = 0;
  let gaps500 = 0;
  for (let i = 1; i < fr.length; i++) {
    const g = fr[i].t - fr[i - 1].t;
    maxGap = Math.max(maxGap, g);
    if (g > 500) gaps500++;
  }
  const last = fr[fr.length - 1];
  const floor = fr.filter((r) => r.audio!.rms <= FLOOR_RMS);
  const voiced = fr.filter((r) => r.audio!.rms > FLOOR_RMS);
  const fieldCounts = new Map<string, number>();
  for (const r of fr) for (const k of Object.keys(r.e)) fieldCounts.set(k, (fieldCounts.get(k) ?? 0) + 1);
  const lagMin = Math.min(...lags);
  const lagMax = Math.max(...lags);
  return {
    frames: fr.length,
    floor: floor.length,
    voiced: voiced.length,
    audioMs: (last.audio!.off + last.audio!.samples - first.audio!.off) / (RATE / 1000),
    voicedMs: voiced.reduce((n, r) => n + r.audio!.samples, 0) / (RATE / 1000),
    wallMs: last.t - first.t,
    firstAfterStart: s.startedAt !== null ? first.t - s.startedAt : null,
    lagMin, lagMax, lagEnd: lags[lags.length - 1], maxGap, gaps500,
    fields: [...fieldCounts].map(([k, n]) => `${k} (${n})`).join(', ') || 'none',
    fieldNames: [...fieldCounts.keys()],
    floorRmsMax: floor.length ? Math.max(...floor.map((r) => r.audio!.rms)) : NaN,
    voicedRmsMin: voiced.length ? Math.min(...voiced.map((r) => r.audio!.rms)) : NaN,
    continuous: lagMax <= 1000,
  };
}
function continuityLine(c: Continuity | null): string {
  if (!c) return 'no audio frames';
  return `${c.frames} frames (${c.floor} floor ≤ ${FLOOR_RMS}, max rms ${c.floorRmsMax.toFixed(5)}; ${c.voiced} voiced, min rms ${c.voicedRmsMin.toFixed(4)}), `
    + `${sec(c.audioMs)} of audio (${sec(c.voicedMs)} voiced) arriving over ${sec(c.wallMs)}, the first ${ms(c.firstAfterStart)} after session.started; `
    + `arrival minus the stream's own sample clock ranges ${ms(c.lagMin)} … ${ms(c.lagMax)} (at the end ${ms(c.lagEnd)}; positive = behind real time, negative = ahead); `
    + `longest gap between frames ${ms(c.maxGap)}, ${c.gaps500} gaps over 500 ms; fields on the frames besides delta: ${c.fields} → `
    + `${c.continuous ? `continuous: never more than 1 s behind real time${c.lagMin < -1000 ? ` (it ran up to ${ms(-c.lagMin)} ahead in bursts)` : ''}` : `NOT continuous: it fell ${ms(c.lagMax)} behind real time, so the stream pauses`}`;
}

// ---------- U4: karaoke on the timeline ----------

/** Whether an output audio frame names its own place on a timeline. */
function frameStampVerdict(s: LiveSession): string {
  const c = continuity(s);
  if (!c) return 'U4 (per-frame stamps): not measured — no audio frames';
  const timing = c.fieldNames.filter((k) => /ms|time|offset|start|end|elapsed|pts/i.test(k));
  return timing.length
    ? `U4 (per-frame stamps): the audio frames carry ${timing.join(', ')}`
    : `U4 (per-frame stamps): none — besides delta the audio frames carry ${c.fields === 'none' ? 'nothing' : `only ${c.fields}`}`;
}

interface Word { word: string; start: number; end: number }

async function wordTimes(pcm: Int16Array, base: string, sessionId: string): Promise<Word[] | null> {
  writeWav(`${base}.played.wav`, pcm, RATE);
  if (offline) {
    const w = flags.words;
    if (typeof w !== 'string' || !fs.existsSync(w)) return null;
    const file = fs.statSync(w).isDirectory() ? path.join(w, `${sessionId}.json`) : w;
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Word[]) : null;
  }
  const cache = `${base}.words.json`;
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8')) as Word[];
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(`${base}.played.wav`)], { type: 'audio/wav' }), 'played.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (/^[a-z]{2}/i.test(target)) form.append('language', target.slice(0, 2).toLowerCase());
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const w = ((await res.json()) as { words?: Word[] }).words ?? [];
  fs.writeFileSync(cache, JSON.stringify(w));
  return w;
}

async function karaoke(s: LiveSession, base: string): Promise<{ lines: string[]; verdict: string }> {
  const lines: string[] = [];
  const cont = continuity(s);
  lines.push(`- output audio: ${continuityLine(cont)}`);
  const outs = deltasOf(s, OUT_T);
  const stamped = outs.filter((o) => o.start !== null && o.end !== null);
  lines.push(`- output transcript: ${outs.length} deltas, ${stamped.length} with start_ms/end_ms`);
  const frames = s.recs.filter((r) => r.audio);
  // Where the stream's sample clock stood when each delta's text arrived, against its end_ms.
  const ahead: number[] = [];
  let fi = 0;
  let cum = 0;
  for (const o of stamped) {
    while (fi < frames.length && frames[fi].t <= o.t) { cum += frames[fi].audio!.samples; fi++; }
    ahead.push(cum / (RATE / 1000) - o.end!);
  }
  if (ahead.length) {
    lines.push(`- at each stamped delta's arrival, output samples received so far ÷ 24 minus its end_ms: median ${ms(median(ahead))} (p10 ${ms(quantile(ahead, 0.1))}, p90 ${ms(quantile(ahead, 0.9))}); positive = its audio had arrived before its text, on the sample clock`);
  }
  const played: Array<{ off: number; samples: number; at: number; t: number }> = [];
  let at = 0;
  for (const r of frames) if (r.audio!.rms > FLOOR_RMS) { played.push({ off: r.audio!.off, samples: r.audio!.samples, at, t: r.t }); at += r.audio!.samples; }
  if (!played.length) return { lines, verdict: 'U4: not measured — no voiced output audio' };
  const pcmAll = int16(Buffer.concat(s.outChunks));
  const playedPcm = concat(...played.map((p) => pcmAll.subarray(p.off, p.off + p.samples)));
  let ws: Word[] | null;
  try {
    ws = await wordTimes(playedPcm, base, String(s.started?.id ?? 'unknown'));
  } catch (err) {
    return { lines: [...lines, `- word timestamps: failed (${(err as Error).message})`], verdict: 'U4: not measured — the transcription failed' };
  }
  if (!ws) return { lines: [...lines, '- word timestamps: none (offline without --words)'], verdict: 'U4: not measured — no word timestamps' };
  /** A time in the played (voiced-only) stream → ms on the full stream's sample clock, and the frame holding it. */
  const locate = (secs: number, edge: 'start' | 'end'): { ms: number; t: number } | null => {
    const smp = secs * RATE - (edge === 'end' ? 1 : 0);
    const p = played.find((x) => smp >= x.at && smp < x.at + x.samples);
    return p ? { ms: (p.off + (smp - p.at) + (edge === 'end' ? 1 : 0)) / (RATE / 1000), t: p.t } : null;
  };
  const wl = ws.map((w) => ({ w, s: locate(w.start, 'start'), e: locate(Math.max(w.start, w.end), 'end') }));
  lines.push(`- whisper-1 on the played stream (${played.length} voiced frames, ${sec((at / RATE) * 1000)}): ${ws.length} words, ${wl.filter((x) => x.s && x.e).length} placed on the full stream`);
  const A = outs.flatMap((o, i) => norm(o.delta).map((w) => ({ w, i })));
  const B = wl.flatMap((x, j) => (x.s && x.e ? norm(x.w.word).map((w) => ({ w, j })) : []));
  const pairs = lcs(A.map((x) => x.w), B.map((x) => x.w));
  const perDelta = new Map<number, { s: number; e: number; tAudio: number }>();
  for (const [ai, bj] of pairs) {
    const i = A[ai].i;
    const x = wl[B[bj].j];
    const cur = perDelta.get(i);
    perDelta.set(i, { s: Math.min(cur?.s ?? Infinity, x.s!.ms), e: Math.max(cur?.e ?? -Infinity, x.e!.ms), tAudio: Math.max(cur?.tAudio ?? -Infinity, x.e!.t) });
  }
  lines.push(`- transcript words matched to whisper words: ${pairs.length} of ${A.length} (${perDelta.size} of ${outs.length} deltas)`);
  const trail = [...perDelta].map(([i, m]) => outs[i].t - m.tAudio);
  if (trail.length) lines.push(`- text trails its audio (a delta's arrival minus the arrival of the frame holding its last word): median ${ms(median(trail))}, p90 ${ms(quantile(trail, 0.9))}`);
  if (!stamped.length) return { lines, verdict: 'U4: arrival — the output deltas carry no start_ms/end_ms, so there is no timeline to align frames to' };
  /** Errors of start_ms/end_ms against whisper, with the audio clock shifted by `c` ms. */
  const errs = (c: number) => {
    const out: number[] = [];
    for (const [i, m] of perDelta) {
      const o = outs[i];
      if (o.start === null || o.end === null) continue;
      out.push(o.start - (m.s + c), o.end - (m.e + c));
    }
    return out;
  };
  const e0 = errs(0);
  if (e0.length < 4) return { lines, verdict: `U4: not measured — only ${e0.length} delta edges matched a word time` };
  const stat = (xs: number[]) => ({ med: median(xs.map(Math.abs)), p90: quantile(xs.map(Math.abs), 0.9) });
  const c1 = cont?.firstAfterStart ?? 0;
  const k0 = stat(e0);
  const k1 = stat(errs(c1));
  const bias = median(e0);
  const kb = stat(errs(bias));
  lines.push(`- start_ms/end_ms against whisper's time for the same words, ${e0.length} edges of ${e0.length / 2} deltas:`);
  lines.push(`  - clock = the output stream's samples ÷ 24 from its first frame: |error| median ${ms(k0.med)}, p90 ${ms(k0.p90)}; signed median ${ms(bias)}`);
  lines.push(`  - clock = session.started + samples ÷ 24 (the first frame arrived ${ms(c1)} after it): |error| median ${ms(k1.med)}, p90 ${ms(k1.p90)}`);
  lines.push(`  - with a fitted constant offset of ${ms(bias)} (not knowable in advance): |error| median ${ms(kb.med)}, p90 ${ms(kb.p90)}`);
  const ok = (k: { med: number; p90: number }) => k.med <= 300 && k.p90 <= 800;
  const contNote = cont?.continuous ? 'the output stream is continuous' : 'the output stream is NOT continuous';
  if (ok(k0)) return { lines, verdict: `U4: timeline karaoke usable — on the output sample clock (samples ÷ 24 from the first frame) |start_ms/end_ms − whisper| median ${ms(k0.med)} ≤ 300 ms, p90 ${ms(k0.p90)} ≤ 800 ms (${e0.length} edges); ${contNote}` };
  if (ok(k1)) return { lines, verdict: `U4: timeline karaoke usable — on the session clock (session.started + samples ÷ 24) |error| median ${ms(k1.med)} ≤ 300 ms, p90 ${ms(k1.p90)} ≤ 800 ms; on the bare sample clock it misses (median ${ms(k0.med)}, p90 ${ms(k0.p90)}); ${contNote}` };
  return { lines, verdict: `U4: arrival — |start_ms/end_ms − whisper| median ${ms(k0.med)}, p90 ${ms(k0.p90)} on the sample clock (${ms(k1.med)}, ${ms(k1.p90)} on the session clock) against thresholds 300 / 800 ms; ${contNote}` };
}

// ---------- U5: pairing ----------

interface Seg { id: string; side: 'source' | 'translation'; openedAt: number; closedAt: number; text: string; lastT: number; origin?: string }
interface Frame { t: number; voiced: boolean }

/** Each side closed by its own silence, as today's L2 input would be (openai-translate.mts's `today`). */
function sourcePlain(ins: Delta[], pause: number): Seg[] {
  const segs: Seg[] = [];
  let open: Seg | null = null;
  let deadline = Infinity;
  for (const e of ins) {
    if (!e.delta) continue;
    if (open && deadline <= e.t) { open.closedAt = deadline; open = null; }
    if (!open) { open = { id: `s${segs.length + 1}`, side: 'source', openedAt: e.t, closedAt: Infinity, text: '', lastT: e.t }; segs.push(open); }
    open.text += e.delta;
    open.lastT = e.t;
    deadline = e.t + pause;
  }
  if (open) open.closedAt = deadline;
  return segs;
}

/** The old client's source rules (OpenAILiveClient.ts:768-840, 997-1038), the stage off. */
function sourceOld(ins: Delta[], pause: number): Seg[] {
  const segs: Seg[] = [];
  let open: Seg | null = null;
  let itemStart: number | null = null;
  let lastEnd: number | null = null;
  let deadline = Infinity;
  let firedOnce = false;
  const complete = (t: number) => {
    itemStart = null;
    if (open) { open.closedAt = t; open = null; }
    firedOnce = false;
    deadline = Infinity;
  };
  const append = (text: string, t: number, start: number | null) => {
    if (!open) {
      open = { id: `s${segs.length + 1}`, side: 'source', openedAt: t, closedAt: Infinity, text: '', lastT: t };
      segs.push(open);
      text = text.replace(/^\s+/, '');
    }
    if (itemStart === null && start !== null) itemStart = start;
    open.text += text;
    open.lastT = t;
  };
  const pauseEnds = (start: number | null) => {
    if (start === null || lastEnd === null) return false;
    const gap = start - lastEnd;
    if (gap < USER_TIMELINE_GAP_MS) return false;
    const span = itemStart === null ? null : lastEnd - itemStart;
    return span === null || span >= USER_MIN_SPAN_MS || gap >= 2 * pause;
  };
  const fire = (upTo: number) => {
    while (open && Number.isFinite(deadline) && deadline <= upTo) {
      const d = deadline;
      const span = itemStart !== null && lastEnd !== null ? lastEnd - itemStart : null;
      if (span !== null && span < USER_MIN_SPAN_MS && !firedOnce) { firedOnce = true; deadline = d + pause; continue; }
      complete(d);
    }
  };
  for (const e of ins) {
    fire(e.t);
    const lead = LEADING_PUNCT_RE.exec(e.delta)?.[0] ?? '';
    let text = e.delta;
    let prefix = open ? (open as Seg).text : '';
    if (!open) text = e.delta.slice(lead.length);
    else if (pauseEnds(e.start)) {
      const mark = lead.trimEnd();
      if (mark.length) append(mark, e.t, e.start);
      complete(e.t);
      text = e.delta.slice(lead.length);
      prefix = '';
    }
    if (text.length) {
      const iStart = itemStart ?? e.start;
      const span = iStart !== null && e.end !== null ? e.end - iStart : null;
      let split = lastSentenceEnd(text, prefix);
      if (split <= 0 && span !== null && span >= USER_SOFT_CAP_MS) split = lastClauseEnd(text);
      if (split > 0) {
        append(text.slice(0, split), e.t, e.start);
        complete(e.t);
        const tail = text.slice(split);
        if (tail.length) append(tail, e.t, e.start);
      } else {
        append(text, e.t, e.start);
        if (span !== null && span >= USER_SPAN_CAP_MS) complete(e.t);
      }
    }
    if (e.end !== null) lastEnd = e.end;
    if (open) { firedOnce = false; deadline = e.t + pause; }
  }
  fire(Infinity);
  return segs;
}

type Ev = { t: number; kind: 'text'; d: Delta } | { t: number; kind: 'frame'; voiced: boolean } | { t: number; kind: 'src'; seg: Seg };
function merged(outs: Delta[], frames: Frame[], sources: Seg[] = []): Ev[] {
  const order = { src: 0, text: 1, frame: 2 } as const;
  const evs: Ev[] = [
    ...sources.filter((s) => Number.isFinite(s.closedAt)).map((seg) => ({ t: seg.closedAt, kind: 'src' as const, seg })),
    ...outs.map((d) => ({ t: d.t, kind: 'text' as const, d })),
    ...frames.map((f) => ({ t: f.t, kind: 'frame' as const, voiced: f.voiced })),
  ];
  return evs.sort((a, b) => a.t - b.t || order[a.kind] - order[b.kind]);
}

function translationPlain(outs: Delta[], frames: Frame[], pause: number): Seg[] {
  const segs: Seg[] = [];
  let open: Seg | null = null;
  let deadline = Infinity;
  for (const ev of merged(outs, frames)) {
    if (ev.kind === 'src' || (ev.kind === 'frame' && !ev.voiced) || (ev.kind === 'text' && !ev.d.delta)) continue;
    if (open && deadline <= ev.t) { open.closedAt = deadline; open = null; }
    if (!open) { open = { id: `t${segs.length + 1}`, side: 'translation', openedAt: ev.t, closedAt: Infinity, text: '', lastT: ev.t }; segs.push(open); }
    if (ev.kind === 'text') { open.text += ev.d.delta; open.lastT = ev.t; }
    deadline = ev.t + pause;
  }
  if (open) open.closedAt = deadline;
  return segs;
}

/** The old client's translation rules (OpenAILiveClient.ts:842-929, 1049-1067, 1326-1403), the stage off. */
function translationOld(outs: Delta[], frames: Frame[], origin: number, pause: number): Seg[] {
  const segs: Seg[] = [];
  let open: Seg | null = null;
  let openStart: number | null = null;
  const maxEnd = new Map<string, number>();
  let pending: Array<{ seg: Seg; endMs: number | null }> = [];
  let handoffAt = Infinity;
  let silenceAt = Infinity;
  const newItem = (t: number): Seg => {
    const s: Seg = { id: `t${segs.length + 1}`, side: 'translation', openedAt: t, closedAt: Infinity, text: '', lastT: t };
    segs.push(s);
    open = s;
    return s;
  };
  const appendText = (text: string, d: Delta): Seg => {
    let s = open as Seg | null;
    if (!s) { text = text.replace(/^\s+/, ''); s = newItem(d.t); }
    if (openStart === null && d.start !== null) openStart = d.start;
    s.text += text;
    s.lastT = d.t;
    if (d.end !== null) maxEnd.set(s.id, Math.max(maxEnd.get(s.id) ?? 0, d.end));
    return s;
  };
  const schedule = (now: number) => {
    const head = pending[0];
    handoffAt = !head ? Infinity : head.endMs !== null ? Math.max(now, origin + head.endMs + AUDIO_HANDOFF_MARGIN_MS) : now;
  };
  const closeText = (s: Seg, t: number) => {
    if (open !== s) return;
    pending.push({ seg: s, endMs: maxEnd.get(s.id) ?? null });
    s.closedAt = t;
    open = null;
    openStart = null;
    schedule(t);
  };
  const fire = (upTo: number) => {
    for (;;) {
      const next = Math.min(handoffAt, silenceAt);
      if (!Number.isFinite(next) || next > upTo) return;
      if (handoffAt <= silenceAt) { const now = handoffAt; pending.shift(); schedule(now); continue; }
      const t = silenceAt;
      pending = [];
      handoffAt = Infinity;
      if (open) { (open as Seg).closedAt = t; open = null; }
      openStart = null;
      silenceAt = Infinity;
    }
  };
  for (const ev of merged(outs, frames)) {
    if (ev.kind === 'src' || (ev.kind === 'frame' && !ev.voiced)) continue;
    fire(ev.t);
    if (ev.kind === 'frame') {
      if (!pending.length && !open) newItem(ev.t);
      silenceAt = ev.t + pause;
      continue;
    }
    const d = ev.d;
    const text = open ? d.delta : d.delta.slice((LEADING_PUNCT_RE.exec(d.delta)?.[0] ?? '').length);
    if (text.length) {
      const iStart = openStart ?? d.start;
      const span = iStart !== null && d.end !== null ? d.end - iStart : null;
      let split = lastSentenceEnd(text, open ? (open as Seg).text : '');
      if (split <= 0 && span !== null && span >= ASSISTANT_SOFT_CAP_MS) split = lastClauseEnd(text);
      if (split > 0) {
        closeText(appendText(text.slice(0, split), d), d.t);
        const tail = text.slice(split);
        if (tail.length) appendText(tail, d);
      } else {
        const s = appendText(text, d);
        if (span !== null && span >= ASSISTANT_SPAN_CAP_MS) closeText(s, d.t);
      }
    }
    silenceAt = d.t + pause;
  }
  fire(Infinity);
  return segs;
}

/**
 * openai-translate.mts's proposed rule (`simulate`, rule `proposed`, audio by arrival, guard by arrival):
 * the translation is cut at its n-th sentence end after each source cut (n = that source segment's
 * sentence ends, at least one), the end arriving after the source's last delta; a translation that stops
 * mid-sentence is held up to 5 s; each cut states its source.
 */
function translationFollows(outs: Delta[], frames: Frame[], sources: Seg[], pause: number): Seg[] {
  const segs: Seg[] = [];
  let open: Seg | null = null;
  let deadline = Infinity;
  const owed: Array<{ ref: string; n: number; lastT: number }> = [];
  let sentencesSinceOpen = 0;
  let cutPending = false;
  let lastSentenceT = 0;
  let trLastT = 0;
  let extended = false;
  const ensure = (t: number): Seg => {
    if (open) return open;
    const s: Seg = { id: `t${segs.length + 1}`, side: 'translation', openedAt: t, closedAt: Infinity, text: '', lastT: t };
    segs.push(s);
    open = s;
    sentencesSinceOpen = 0;
    return s;
  };
  const close = (t: number) => {
    const s = open as Seg | null;
    if (!s) return;
    s.closedAt = t;
    open = null;
    deadline = Infinity;
    if (s.origin === undefined && owed.length) s.origin = owed.shift()!.ref;
    cutPending = false;
  };
  const checkOwed = () => {
    if (!open || !owed.length || cutPending) return;
    if (sentencesSinceOpen >= owed[0].n && lastSentenceT > owed[0].lastT) cutPending = true;
  };
  const fire = (upTo: number) => {
    while (open && Number.isFinite(deadline) && deadline <= upTo) {
      const d = deadline;
      if (!extended && !/[.?!。？！]\s*$/.test((open as Seg).text)) { extended = true; deadline = trLastT + MID_HOLD_MS; continue; }
      close(d);
    }
  };
  for (const ev of merged(outs, frames, sources)) {
    fire(ev.t);
    if (ev.kind === 'src') {
      owed.push({ ref: ev.seg.id, n: Math.max(1, sentenceEnds(ev.seg.text).length), lastT: ev.seg.lastT });
      checkOwed();
      continue;
    }
    if (ev.kind === 'text') {
      if (!ev.d.delta) continue;
      if (cutPending && open) {
        (open as Seg).origin = owed.shift()!.ref;
        close(ev.t);
      }
      const s = ensure(ev.t);
      s.text += ev.d.delta;
      s.lastT = ev.t;
      const total = sentenceEnds(s.text).length;
      if (total > sentencesSinceOpen) lastSentenceT = ev.t;
      sentencesSinceOpen = total;
      trLastT = ev.t;
      extended = false;
      deadline = ev.t + pause;
      checkOwed();
      continue;
    }
    if (!ev.voiced) continue;
    trLastT = ev.t;
    extended = false;
    ensure(ev.t);
    deadline = ev.t + pause;
  }
  fire(Infinity);
  close(Infinity);
  return segs;
}

/** L2's untimed inference (src/lib/projection/pair.ts), on segments in the order they opened. */
function proximityPairs(src: Seg[], tr: Seg[]): Map<string, string> {
  const segs: Segment[] = [...src, ...tr]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.openedAt - b.s.openedAt || a.i - b.i)
    .map(({ s }, ref) => ({ id: s.id, ref, side: s.side, text: s.text, final: true, openedAt: s.openedAt, marks: [], speech: [] }));
  return inferPairs(segs, DEFAULT_PAIRING);
}
const statedPairs = (tr: Seg[]) => new Map(tr.filter((t) => t.origin !== undefined).map((t) => [t.id, t.origin!] as [string, string]));

interface PairStats { sources: number; translations: number; empty: number; paired: number; orphans: number; right: number; wrong: number; unknown: number }
function pairStats(src: Seg[], tr: Seg[], pairs: Map<string, string>, marks: Mark[]): PairStats {
  const withText = tr.filter((t) => words(t.text));
  const byId = new Map([...src, ...tr].map((s) => [s.id, s]));
  const heard = (text: string) => new Set(marks.filter((m) => m.heard.test(text)).map((m) => m.id));
  const said = (text: string) => new Set(saidOk ? marks.filter((m) => m.said.test(text)).map((m) => m.id) : []);
  let right = 0;
  let wrong = 0;
  let unknown = 0;
  for (const [tid, sid] of pairs) {
    const h = heard(byId.get(sid)?.text ?? '');
    const d = said(byId.get(tid)?.text ?? '');
    if (!h.size || !d.size) unknown++;
    else if ([...h].some((x) => d.has(x))) right++;
    else wrong++;
  }
  return {
    sources: src.length, translations: withText.length, empty: tr.length - withText.length,
    paired: new Set(pairs.values()).size, orphans: withText.filter((t) => !pairs.has(t.id)).length, right, wrong, unknown,
  };
}
const holds = (p: PairStats) => p.sources > 0 && p.paired / p.sources >= 0.9 && p.orphans === 0 && p.wrong === 0;

/** Input stamps against the clip: which clock start_ms/end_ms are on, and which script sentence each delta belongs to. */
function sourceMap(ins: Delta[], clip: Clip, clipStart: number, startedAt: number): { of: number[]; lines: string[]; verdict: string } {
  const lines: string[] = [];
  const stamped = ins.filter((d) => d.start !== null && d.end !== null);
  const gapMs = clipStart - startedAt;
  /** Transcribed time that would fall in the clip's silences (±200 ms) were the stamps `off` ms ahead of the clip's clock. */
  const inSilence = (off: number) => {
    let total = 0;
    for (const d of stamped) {
      const a = d.start! - off;
      const b = d.end! - off;
      let covered = 0;
      for (const m of clip.marks) covered += Math.max(0, Math.min(b, m.endMs + 200) - Math.max(a, m.startMs - 200));
      total += Math.max(0, b - a - covered);
    }
    return total;
  };
  // The offset that puts the least transcribed time into silence (the middle of the best plateau), then the named clock it matches.
  const tries: Array<{ off: number; miss: number }> = [];
  for (let off = -3000; off <= 6000; off += 20) tries.push({ off, miss: inSilence(off) });
  const least = Math.min(...tries.map((x) => x.miss));
  const plateau = tries.filter((x) => x.miss <= least + 1).map((x) => x.off);
  const fitted = plateau.length ? plateau[Math.floor(plateau.length / 2)] : 0;
  const clocks = [
    { name: 'the appended-audio clock (0 = the first appended sample)', off: 0 },
    { name: 'the session clock (0 = session.started)', off: gapMs },
  ];
  /** A clock fits when its own misfit is within max(150 ms, 15%) of the best one's. */
  const near = clocks.filter((c) => inSilence(c.off) <= least + Math.max(150, 0.15 * least));
  const usable = stamped.length >= 2 && Number.isFinite(least);
  const verdict = !usable
    ? `U5 (input stamps): ${stamped.length}/${ins.length} input deltas stamped — too few to fit a clock; sentences assigned by arrival`
    : near.length === 2
      ? `U5 (input stamps): both clocks fit (best offset ${ms(fitted)}; the first append came ${ms(gapMs)} after session.started) — the data cannot tell them apart`
      : near.length === 1
        ? `U5 (input stamps): start_ms/end_ms are on ${near[0].name} — the best-fitting offset is ${ms(fitted)} (the clocks are ${ms(gapMs)} apart; ${ms(inSilence(fitted))} of transcribed time in silence there, ${ms(inSilence(clocks.find((c) => c !== near[0])!.off))} on the other clock)`
        : `U5 (input stamps): on neither clock — the best-fitting offset is ${ms(fitted)} from the first appended sample (session.started is ${ms(gapMs)} before it)`;
  const of: number[] = [];
  if (usable) {
    const off = fitted;
    let prev = 0;
    for (const d of ins) {
      if (d.start === null || d.end === null) { of.push(prev); continue; }
      const mid = (d.start + d.end) / 2 - off;
      let k = 0;
      let bestDist = Infinity;
      clip.marks.forEach((m, i) => {
        const dist = mid < m.startMs ? m.startMs - mid : mid > m.endMs ? mid - m.endMs : 0;
        if (dist < bestDist) { bestDist = dist; k = i; }
      });
      of.push(k);
      prev = k;
    }
    const first = stamped[0];
    lines.push(`- input stamps: ${stamped.length}/${ins.length} deltas carry start_ms/end_ms; the offset that best fits them to the clip's speech is ${ms(fitted)} from the first appended sample (plateau ${ms(plateau[0])} … ${ms(plateau[plateau.length - 1])}, ${ms(least)} of transcribed time in silence there); the first appended sample came ${ms(gapMs)} after session.started; the first input delta says start_ms ${first.start}, the clip's first sentence starts at ${clip.marks[0]?.startMs ?? '—'} ms. Deltas are given to sentences at that offset.`);
  } else {
    for (const d of ins) {
      let k = 0;
      clip.marks.forEach((m, i) => { if (clipStart + m.startMs <= d.t - 200) k = i; });
      of.push(k);
    }
    lines.push(`- input stamps: ${stamped.length}/${ins.length} deltas stamped: deltas assigned to sentences by arrival (approximate)`);
  }
  return { of, lines, verdict };
}

/** The translation split at its sentence ends, each English sentence given to a script sentence by keyword. */
function translationMap(outs: Delta[], marks: Mark[]): number[] {
  const firstOf: number[] = marks.map(() => -1);
  if (!outs.length) return firstOf;
  const starts: number[] = [];
  let full = '';
  for (const d of outs) { starts.push(full.length); full += d.delta; }
  const deltaAt = (ch: number) => { let i = 0; while (i + 1 < starts.length && starts[i + 1] <= ch) i++; return i; };
  const ends = sentenceEnds(full);
  const spans: Array<{ text: string; first: number }> = [];
  let from = 0;
  for (const end of [...ends, full.length]) {
    if (end <= from) continue;
    const text = full.slice(from, end);
    const lead = text.search(/[\p{L}\p{N}]/u);
    if (lead >= 0) spans.push({ text, first: deltaAt(from + lead) });
    from = end;
  }
  const assign: Array<number | null> = spans.map(() => null);
  let k = 0;
  spans.forEach((sp, j) => {
    for (let m = k; m < marks.length; m++) if (marks[m].said.test(sp.text)) { assign[j] = m; k = m; return; }
  });
  // An English sentence with no keyword belongs to the next one that has one (a translation starts before its keyword).
  let next: number | null = null;
  for (let j = spans.length - 1; j >= 0; j--) {
    if (assign[j] !== null) next = assign[j];
    else if (next !== null) assign[j] = next;
  }
  spans.forEach((sp, j) => {
    const m = assign[j];
    if (m !== null && (firstOf[m] < 0 || sp.first < firstOf[m])) firstOf[m] = sp.first;
  });
  return firstOf;
}

function pairing(s: LiveSession, clip: Clip, clipStart: number): { lines: string[]; verdicts: string[] } {
  const ins = deltasOf(s, IN_T);
  const outs = deltasOf(s, OUT_T);
  const frames: Frame[] = s.recs.filter((r) => r.audio).map((r) => ({ t: r.t, voiced: r.audio!.rms > FLOOR_RMS }));
  const lines: string[] = [];
  const verdicts: string[] = [];
  const startedAt = s.startedAt ?? 0;
  const sm = sourceMap(ins, clip, clipStart, startedAt);
  lines.push(...sm.lines);
  verdicts.push(sm.verdict);
  const firstOut = saidOk ? translationMap(outs, clip.marks) : null;
  lines.push('', '| # | source sentence (clip) | its input deltas: first → last arrival | last end_ms | its translation\'s first delta: arrival | start_ms | lag, arrival | lag, end_ms → start_ms | source opened → translation text |', '|---|---|---|---|---|---|---|---|---|');
  const lagsArrival: number[] = [];
  const lagsTimeline: number[] = [];
  clip.marks.forEach((m, k) => {
    const mine = ins.map((d, i) => ({ d, k: sm.of[i] })).filter((x) => x.k === k).map((x) => x.d);
    const firstIn = mine[0];
    const lastIn = mine[mine.length - 1];
    const fo = firstOut && firstOut[k] >= 0 ? outs[firstOut[k]] : undefined;
    const la = lastIn && fo ? fo.t - lastIn.t : null;
    const lt = lastIn && fo && lastIn.end !== null && fo.start !== null ? fo.start - lastIn.end : null;
    if (la !== null) lagsArrival.push(la);
    if (lt !== null) lagsTimeline.push(lt);
    lines.push(`| ${k + 1} | ${clip1(m.text, 24)} (${sec(m.startMs)}–${sec(m.endMs)}) | ${firstIn ? `${sec(firstIn.t - clipStart)} → ${sec(lastIn.t - clipStart)} (${mine.length})` : '—'} | ${lastIn?.end ?? '—'} | ${fo ? `${sec(fo.t - clipStart)} “${clip1(fo.delta.trim(), 20)}”` : saidOk ? 'not found' : 'no keyword map'} | ${fo?.start ?? '—'} | ${ms(la)} | ${ms(lt)} | ${firstIn && fo ? ms(fo.t - firstIn.t) : '—'} |`);
  });
  lines.push('', '(Times are from the first appended sample. Lag = the translation\'s first output delta after the source sentence\'s last input delta; the end_ms → start_ms column assumes input and output stamps share one timeline.)', '');
  if (lagsArrival.length) {
    lines.push(`- lag, arrival: median ${ms(median(lagsArrival))}, max ${ms(Math.max(...lagsArrival))}; end_ms → start_ms: ${lagsTimeline.length ? `median ${ms(median(lagsTimeline))}, max ${ms(Math.max(...lagsTimeline))}` : 'unstamped'}`);
  }

  const sims: Array<{ name: string; src: Seg[]; trOwn: Seg[] }> = [
    { name: `the old client's rules (pause ${pauseMs} ms)`, src: sourceOld(ins, pauseMs), trOwn: translationOld(outs, frames, startedAt, pauseMs) },
    { name: `a plain ${pauseMs} ms silence per side`, src: sourcePlain(ins, pauseMs), trOwn: translationPlain(outs, frames, pauseMs) },
  ];
  const statLine = (p: PairStats) => `sources ${p.sources}, translations ${p.translations}${p.empty ? ` (+${p.empty} audio-only)` : ''}; sources paired ${p.paired}/${p.sources}, translations orphaned ${p.orphans}; by keyword ${p.right} right, ${p.wrong} wrong, ${p.unknown} unknown`;
  const verdictOf = (p: PairStats) => (p.sources === 0 ? 'not measured (no source segments)' : holds(p) ? 'holds' : 'fails');
  for (const sim of sims) {
    const prox = proximityPairs(sim.src, sim.trOwn);
    const follow = translationFollows(outs, frames, sim.src, pauseMs);
    const fp = statedPairs(follow);
    const ps = pairStats(sim.src, sim.trOwn, prox, clip.marks);
    const fs2 = pairStats(sim.src, follow, fp, clip.marks);
    lines.push(`- **segments by ${sim.name}**`);
    lines.push(`  - L2 proximity (${PROXIMITY_MS} ms, pair.ts): ${statLine(ps)}`);
    lines.push(`  - the translation follows the source's cuts (stated pairs): ${statLine(fs2)}`);
    lines.push(...listing(sim.src, sim.trOwn, prox, 'proximity'), ...listing(sim.src, follow, fp, 'follows'));
    verdicts.push(`U5 (L2 proximity ${PROXIMITY_MS} ms, segments by ${sim.name}): ${verdictOf(ps)} — ${ps.paired}/${ps.sources} sources paired, ${ps.orphans} orphaned translations, ${ps.wrong} paired with the wrong sentence (holds = ≥ 90% paired, none orphaned or wrong)`);
    verdicts.push(`U5 (translation follows the source's cuts, segments by ${sim.name}): ${verdictOf(fs2)} — ${fs2.paired}/${fs2.sources} paired, ${fs2.orphans} orphaned, ${fs2.wrong} wrong`);
  }
  if (lagsArrival.length) {
    const beyond = lagsArrival.filter((x) => x > PROXIMITY_MS).length;
    verdicts.push(`U5 (lag): a translation's first delta comes a median ${ms(median(lagsArrival))} after its source sentence's last input delta; ${beyond} of ${lagsArrival.length} sentences beyond the ${PROXIMITY_MS} ms window`);
  }
  return { lines, verdicts };
}
function listing(src: Seg[], tr: Seg[], pairs: Map<string, string>, label: string): string[] {
  const out: string[] = [`  - ${label}:`];
  const bySrc = new Map<string, Seg[]>();
  for (const t of tr) { const o = pairs.get(t.id); if (o) bySrc.set(o, [...(bySrc.get(o) ?? []), t]); }
  for (const s of src) {
    const ts = bySrc.get(s.id) ?? [];
    out.push(`    - ${s.id} @${sec(s.openedAt)} “${clip1(s.text.trim(), 60)}” → ${ts.length ? ts.map((t) => `${t.id} @${sec(t.openedAt)} “${clip1(t.text.trim(), 70)}”`).join(' + ') : '(none)'}`);
  }
  for (const t of tr) if (!pairs.has(t.id) && words(t.text)) out.push(`    - unpaired ${t.id} @${sec(t.openedAt)} “${clip1(t.text.trim(), 70)}”`);
  return out;
}

// ---------- U8, U12 ----------

function stallCheck(s: LiveSession): { lines: string[]; verdict: string } {
  const us = usageOf(s).filter((u) => u.seconds !== null) as Array<{ t: number; seconds: number }>;
  const lines: string[] = [];
  const steps = us.slice(1).map((u, i) => ({ dt: u.t - us[i].t, ds: u.seconds - us[i].seconds }));
  lines.push(`- session.usage.updated: ${us.length} reports${us.length ? `, seconds ${us[0].seconds} → ${us[us.length - 1].seconds}` : ''}${steps.length ? `, every ${sec(median(steps.map((x) => x.dt)))} (median), +${median(steps.map((x) => x.ds))} s per report (median)` : ''}`);
  let frozenAt: { t: number; seconds: number } | null = null;
  for (let i = 1; i < us.length && !frozenAt; i++) {
    if (us[i].seconds === us[i - 1].seconds && s.inputs.some((x) => x.rms > 0 && x.t > us[i - 1].t && x.t <= us[i].t)) frozenAt = us[i];
  }
  const closed = s.closedFrame();
  const unrequested = closed && (s.closeSentAt === null || closed.t < s.closeSentAt) ? closed : null;
  const abnormal = s.sock && !closed && (s.closeSentAt === null || s.sock.t < s.closeSentAt) ? s.sock : null;
  if (unrequested) lines.push(`- the server sent session.closed unrequested at ${sec(unrequested.t)}: ${JSON.stringify(unrequested.e)}`);
  if (abnormal) lines.push(`- the socket closed without session.closed at ${sec(abnormal.t)}: code ${abnormal.code} ${abnormal.reason}`);
  if (!frozenAt && !abnormal && us.length < 2) return { lines, verdict: `U8: no stall seen, but only ${us.length} usage report${us.length === 1 ? '' : 's'} arrived — the freeze check needs two${unrequested ? `; the server closed the session (${String(unrequested.e.reason)})` : ''}` };
  if (frozenAt) return { lines, verdict: `U8: stall signature — usage froze at ${frozenAt.seconds} s (report at ${sec(frozenAt.t)}) while voiced input was sent${abnormal ? `; the socket then closed with ${abnormal.code} and no session.closed` : ''} (the old watchdog: two equal reports with voiced input between)` };
  if (abnormal) return { lines, verdict: `U8: the socket closed without session.closed (code ${abnormal.code}) but usage never froze` };
  return { lines, verdict: `U8: no stall in this run — usage advanced between every pair of its ${us.length} consecutive reports${unrequested ? `; but the server closed the session (${String(unrequested.e.reason)})` : ''}` };
}

function delegationCheck(s: LiveSession, dir: string, name: string, refused?: string): { lines: string[]; verdict: string } {
  const count = s.recs.filter((r) => r.type === 'session.delegation.created').length;
  const other = delegation === 'client' ? 'null' : 'client';
  const lines = [`- session.delegation.created with delegation ${delegation}: ${count}`];
  const mine = `${stamp()}-${name}.jsonl`;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(`-timeline-${other}.jsonl`) && f !== mine).sort();
  const last = files[files.length - 1];
  let otherRun: { count: number; started: boolean; error: string | null } | null = null;
  if (last) {
    const recs = fs.readFileSync(path.join(dir, last), 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l) as { dir: string; type: string; d?: Record<string, unknown> }; } catch { return null; } });
    const err = recs.find((r) => r?.dir === 'in' && r.type === 'error');
    otherRun = {
      count: recs.filter((r) => r?.dir === 'in' && r.type === 'session.delegation.created').length,
      started: recs.some((r) => r?.dir === 'in' && r.type === 'session.started'),
      error: err ? JSON.stringify(err.d).slice(0, 300) : null,
    };
    lines.push(`- the latest delegation ${other} run in this directory (${last}): ${otherRun.started ? 'started' : `not started${otherRun.error ? `, error ${otherRun.error}` : ''}`}, ${otherRun.count} session.delegation.created`);
  }
  const nullRun = delegation === 'null' ? { count, started: !refused, error: refused ?? null } : otherRun;
  const clientRun = delegation === 'client' ? { count, started: !refused } : otherRun;
  if (nullRun && !nullRun.started) return { lines, verdict: `U12: delegation null refused${nullRun.error ? ` — ${nullRun.error}` : ''}; keep { type: 'client' }${clientRun ? ` (${clientRun.count} session.delegation.created with it)` : ''}` };
  if (!nullRun || !clientRun) return { lines, verdict: `U12: delegation ${delegation} → ${refused ? `refused (${refused})` : `${count} session.delegation.created`}; run \`timeline --delegation ${other}\` for the comparison` };
  const cmp = nullRun.count < clientRun.count ? 'null removes them' : nullRun.count === clientRun.count ? 'no difference' : 'null gives more';
  return { lines, verdict: `U12: delegation null accepted — session.delegation.created ${nullRun.count} with null vs ${clientRun.count} with client: ${cmp}` };
}

// ---------- reports ----------

function header(name: string, extra: string[] = []): string[] {
  return [
    `- mode ${name}; endpoint ${host}${offline ? ' (offline stand-in)' : ''}; model ${MODEL}; voice ${voice}; target ${target} (${languageName(target)})`,
    ...extra,
  ];
}
function block(head: string[], measured: string[], verdicts: string[]): string {
  return [...head, '', '### Measured', '', ...measured, '', '### Verdict', '', ...verdicts.map((v) => `- ${v}`)].join('\n');
}

/** The last script sentence's translation has been said — its keyword, then a sentence end — by `T`. */
function finishedBy(outs: Delta[], mark: Mark, T: number): boolean {
  const text = textOf(outs, -Infinity, T);
  if (saidOk) {
    const at = lastMatch(mark.said, text);
    return at >= 0 && /[.?!。？！]/.test(text.slice(at));
  }
  return /[.?!。？！]\s*$/.test(text.trim());
}
function firstFinish(outs: Delta[], mark: Mark, from: number, to: number): number | null {
  for (const d of outs) if (d.t > from && d.t <= to && finishedBy(outs, mark, d.t)) return d.t;
  return null;
}
/**
 * Billed seconds across [from, to]: from the last report at or before `from` (session.started counts as
 * 0 s) to the first at or after `to` (else the last one), and the rate between them — ≈ 1 s per s while
 * billing runs, ≈ 0 while it does not.
 */
function usageAcross(s: LiveSession, from: number, to: number): { text: string; rate: number | null } {
  const us: Array<{ t: number; seconds: number }> = [
    ...(s.startedAt !== null ? [{ t: s.startedAt, seconds: 0 }] : []),
    ...(usageOf(s).filter((u) => u.seconds !== null) as Array<{ t: number; seconds: number }>),
  ];
  // Two reports inside the span measure it alone; otherwise the nearest ones around it.
  const inside = us.filter((u) => u.t >= from && u.t <= to);
  const before = inside.length >= 2 ? inside[0] : us.filter((u) => u.t <= from).pop();
  const after = inside.length >= 2 ? inside[inside.length - 1] : us.find((u) => u.t >= to) ?? us[us.length - 1];
  if (!before || !after || after.t <= before.t) return { text: 'no usage reports around it', rate: null };
  const ds = after.seconds - before.seconds;
  const dt = (after.t - before.t) / 1000;
  const rate = ds / dt;
  return { text: `billed ${before.seconds} s (${sec(before.t - from)} from the span's start) → ${after.seconds} s (${sec(after.t - from)}): +${ds} s over ${dt.toFixed(1)} s, ${rate.toFixed(2)} s per s`, rate };
}
function spanLine(s: LiveSession, from: number, to: number): string {
  const outs = deltasOf(s, OUT_T).filter((d) => d.t > from && d.t <= to);
  const ins = deltasOf(s, IN_T).filter((d) => d.t > from && d.t <= to);
  const fr = s.recs.filter((r) => r.audio && r.t > from && r.t <= to);
  const voiced = fr.filter((r) => r.audio!.rms > FLOOR_RMS);
  const lastVoiced = voiced[voiced.length - 1];
  const reports = usageOf(s).filter((u) => u.t > from && u.t <= to).map((u) => `${sec(u.t - from)}: ${u.seconds}`);
  return `${sec(to - from)}: ${outs.length} output text deltas “${clip1(outs.map((d) => d.delta).join('').trim(), 120)}”; ${ins.length} input deltas; `
    + `${fr.length} audio frames (${voiced.length} voiced, ${sec(voiced.reduce((n, r) => n + r.audio!.samples, 0) / (RATE / 1000))}${lastVoiced ? `, the last ${sec(lastVoiced.t - from)} in` : ''}); `
    + `usage reports inside [${reports.join(', ')}]; ${usageAcross(s, from, to).text}`;
}

// ---------- modes ----------

async function headersMode(): Promise<void> {
  const run = startRun(PROVIDER, 'headers', outDir);
  const cases: Array<{ name: string; want: { status: number; code?: string }; headers: Record<string, string>; protocols?: string[] }> = [
    { name: 'with Origin (and a good Bearer)', want: { status: 403 }, headers: { Authorization: `Bearer ${key}`, Origin: 'https://sokuji.kizuna.ai' } },
    { name: 'subprotocol only (openai-insecure-api-key.<key>, no Authorization)', want: { status: 401, code: 'missing_authorization' }, headers: {}, protocols: ['realtime', `openai-insecure-api-key.${key}`] },
    { name: 'bogus Bearer', want: { status: 401, code: 'invalid_api_key' }, headers: { Authorization: 'Bearer sk-bogus-live-probe-0000' } },
  ];
  const measured: string[] = [];
  const verdicts: string[] = [];
  for (const c of cases) {
    const s = dial(run, 'headers', { headers: c.headers, protocols: c.protocols, pcm: false });
    const opened = await s.waitOpen(15_000);
    let status: number | null = null;
    let code: string | null = null;
    let body = '';
    if (opened) { status = 101; s.terminate(); await s.idle(1000); } else if (s.refused) {
      status = s.refused.status;
      body = s.refused.body;
      try { code = String(obj(obj(JSON.parse(body)).error).code ?? '') || null; } catch { code = null; }
    }
    measured.push(`- ${c.name}: ${status === null ? `no answer${s.sock ? ` (closed ${s.sock.code})` : ''}` : status}${code ? ` ${code}` : ''}${body ? ` — ${clip1(body.replace(/\s+/g, ' '), 300)}` : ''}`);
    const ok = status === c.want.status && (!c.want.code || code === c.want.code);
    verdicts.push(`U9 (${c.name}): ${ok ? 'holds' : 'CHANGED'} — got ${status ?? 'nothing'}${code ? ` ${code}` : ''}, expected ${c.want.status}${c.want.code ? ` ${c.want.code}` : ''}`);
  }
  const s = dial(run, 'headers');
  const t0 = run.now();
  const opened = await s.waitOpen(15_000);
  if (!opened) {
    measured.push(`- the good upgrade: refused ${s.refused ? `${s.refused.status} ${clip1(s.refused.body, 300)}` : s.sock?.code ?? 'timeout'}`);
    verdicts.push('U9 (good upgrade, Bearer and no Origin): FAILED — the upgrade was refused');
  } else {
    const up = run.now() - t0;
    const st = await s.start(sessionStart());
    const c = await s.close();
    measured.push(`- the good upgrade: 101 in ${ms(up)}; session.start → ${st.outcome} in ${ms(st.ms)}${s.started ? ` (id ${String(s.started.id)}, expires_at ${String(s.started.expires_at)})` : ''}; session.close → ${c.closed ? `session.closed ${JSON.stringify(c.closed.e)} in ${ms(c.took)}` : 'no session.closed'}; socket ${s.sock ? `closed ${s.sock.code}` : 'open'}`);
    measured.push(`- ${costLine(s)}`);
    verdicts.push(st.outcome === 'started'
      ? `U9 (good upgrade, Bearer and no Origin): 101, session.started in ${ms(st.ms)}; session.close → ${c.closed ? `session.closed (${String(c.closed.e.reason)}) in ${ms(c.took)}` : `no session.closed within ${CLOSE_WAIT_MS} ms`}`
      : `U9 (good upgrade): 101 but session.start → ${st.outcome}${st.rec ? ` ${errorLine(st.rec)}` : ''}`);
  }
  run.report(block(header('headers'), measured, verdicts));
}

async function timelineMode(): Promise<void> {
  const name = `timeline-${delegation}`;
  const run = startRun(PROVIDER, name, outDir);
  const clip = await build(scripts().main);
  const base = path.join(outDir, `${stamp()}-${name}`);
  writeWav(`${base}.in.wav`, clip.pcm, RATE);
  run.log('note', 'config', { mode: 'timeline', delegation, clip: clipLabel, target, voice, marks: clip.marks.map((m) => ({ id: m.id, text: m.text, startMs: m.startMs, endMs: m.endMs })) });
  const head = header(name, [`- 1 s with no appends, then clip ${clipLabel}: ${clip.marks.length} sentences, ${sec(clip.ms)}, then 15 s of silence; delegation ${delegation}`]);
  const s = dial(run, name);
  const opened = await s.waitOpen(15_000);
  const st = opened ? await s.start(sessionStart()) : null;
  if (!st || st.outcome !== 'started') {
    const why = !opened ? `upgrade refused ${s.refused ? `${s.refused.status} ${clip1(s.refused.body, 200)}` : ''}` : `session.start → ${st?.outcome}${st?.rec ? ` ${errorLine(st.rec)}` : ''}`;
    await s.close();
    const d = delegationCheck(s, outDir, name, why);
    run.report(block(head, [`- ${why}`, ...d.lines], [d.verdict, 'U4, U5, U8: not measured — the session never started']));
    return;
  }
  // A second with nothing appended first: the input stamps then tell the appended-audio clock from the session's.
  await s.idle(1000);
  const clipStart = run.now();
  run.log('note', 'clip_start', { t: clipStart });
  await paceInto([s], concat(clip.pcm, silence(15_000, RATE)));
  run.log('note', 'clip_end', { speechEnd: clipStart + clip.ms, t: run.now() });
  await s.close();
  const k = await karaoke(s, base);
  const p = pairing(s, clip, clipStart);
  const st8 = stallCheck(s);
  const d = delegationCheck(s, outDir, name);
  const measured = [
    `- ${costLine(s)}`,
    `- input: ${deltasOf(s, IN_T).length} deltas “${clip1(textOf(deltasOf(s, IN_T)).trim(), 200)}”`,
    `- output: ${deltasOf(s, OUT_T).length} deltas “${clip1(textOf(deltasOf(s, OUT_T)).trim(), 200)}”`,
    ...errorsOf(s).map((r) => `- error at ${sec(r.t)}: ${errorLine(r)}`),
    '', '#### U4 — the output audio and the karaoke timeline', '', ...k.lines,
    '', '#### U5 — pairing', '', ...p.lines,
    '', '#### U8, U12', '', ...st8.lines, ...d.lines,
  ];
  run.report(block(head, measured, [k.verdict, frameStampVerdict(s), ...p.verdicts, st8.verdict, d.verdict]));
}

async function releaseMode(): Promise<void> {
  const run = startRun(PROVIDER, 'release', outDir);
  const clip = await build(scripts().main);
  const base = path.join(outDir, `${stamp()}-release`);
  writeWav(`${base}.in.wav`, clip.pcm, RATE);
  run.log('note', 'config', { mode: 'release', clip: clipLabel, target, marks: clip.marks.map((m) => ({ id: m.id, text: m.text, startMs: m.startMs, endMs: m.endMs })) });
  const s = await startedSession(run, 'release');
  const clipStart = run.now();
  await paceInto([s], clip.pcm);
  const clipEnd = run.now();
  run.log('note', 'no_appends', { from: clipEnd, ms: 20_000 });
  await s.idle(20_000);
  const quietEnd = run.now();
  run.log('note', 'silence', { from: quietEnd, ms: 10_000 });
  await paceInto([s], silence(10_000, RATE));
  const silenceEnd = run.now();
  await s.close();
  const outs = deltasOf(s, OUT_T);
  const last = clip.marks[clip.marks.length - 1];
  const already = finishedBy(outs, last, clipEnd);
  const inQuiet = firstFinish(outs, last, clipEnd, quietEnd);
  const inSilence = inQuiet === null && !already ? firstFinish(outs, last, quietEnd, silenceEnd + CLOSE_WAIT_MS) : null;
  /** When the last sentence's keyword first appeared in the translation, finished or not. */
  const saidAt = saidOk ? outs.find((d) => lastMatch(last.said, textOf(outs, -Infinity, d.t)) >= 0)?.t ?? null : null;
  const measured = [
    `- ${costLine(s)}`,
    `- clip ${clipLabel}, ${clip.marks.length} sentences, ${sec(clip.ms)}; the last: “${last.text}”${saidOk ? ` (its translation keyword ${last.said})` : ' (no keyword map for this target: "finished" = the output ends in a sentence end)'}`,
    `- the clip, ${spanLine(s, clipStart, clipEnd)}`,
    `- no appends, ${spanLine(s, clipEnd, quietEnd)}`,
    `- paced silence, ${spanLine(s, quietEnd, silenceEnd)}`,
    `- after the silence until the end, ${spanLine(s, silenceEnd, s.sock?.t ?? run.now())}`,
    `- output audio over the no-append span: ${continuityLine(continuity(s, clipEnd, quietEnd))}`,
    `- the last sentence's translation finished ${already ? 'before appends stopped (inconclusive)' : inQuiet !== null ? `${sec(inQuiet - clipEnd)} into the no-append span` : inSilence !== null ? `${sec(inSilence - quietEnd)} after silence resumed` : 'never'}`,
    `- output text: “${clip1(textOf(outs).trim(), 400)}”`,
  ];
  const voicedQuiet = s.recs.filter((r) => r.audio && r.t > clipEnd && r.t <= quietEnd && r.audio.rms > FLOOR_RMS).length;
  const verdicts = [
    already
      ? 'U1: inconclusive — the last sentence was already translated when appends stopped; rerun with a longer last sentence'
      : inQuiet !== null
        ? `U1: release needs nothing — the last sentence's translation completed ${sec(inQuiet - clipEnd)} into the 20 s with nothing appended (threshold: complete within that span)`
        : inSilence !== null
          ? `U1: needs a tail — the last sentence's translation completed only ${sec(inSilence - quietEnd)} after paced silence resumed`
          : saidAt !== null
            ? `U1: inconclusive — the last sentence's keyword reached the translation ${sec(saidAt - clipEnd)} after appends stopped, but no sentence end followed it; read the no-append span's text and audio above`
            : 'U1: needs a tail — the last sentence\'s translation never completed, not even after 10 s of silence',
    `U1 (output with nothing appended): ${outs.filter((d) => d.t > clipEnd && d.t <= quietEnd).length} text deltas and ${voicedQuiet} voiced frames in the 20 s; ${usageAcross(s, clipEnd, quietEnd).text}`,
  ];
  run.report(block(header('release', [`- the clip, then 20 s with no appends, then 10 s of paced silence`]), measured, verdicts));
}

async function muteMode(): Promise<void> {
  const run = startRun(PROVIDER, 'mute', outDir);
  const sc = scripts();
  const A = await build(sc.muteA);
  const M = await build(sc.muteM);
  const B = await build(sc.muteB);
  run.log('note', 'config', { mode: 'mute', clip: clipLabel, A: A.marks.map((m) => m.id), muted: M.marks.map((m) => m.id), B: B.marks.map((m) => m.id) });
  const s = await startedSession(run, 'mute');
  const clipStart = run.now();
  await paceInto([s], A.pcm);
  const tMute = run.now();
  const sinceMute = s.recs.length;
  s.send({ type: 'session.input_audio.mute', event_id: 'mute_1' });
  await paceInto([s], M.pcm);
  const tMutedEnd = run.now();
  await paceInto([s], silence(Math.max(0, 20_000 - (tMutedEnd - tMute)), RATE));
  const tUnmute = run.now();
  const sinceUnmute = s.recs.length;
  s.send({ type: 'session.input_audio.unmute', event_id: 'unmute_1' });
  await paceInto([s], B.pcm);
  const tB = run.now();
  await paceInto([s], silence(10_000, RATE));
  await s.close();
  /** The ack, or an error frame within 5 s of the send. */
  const reply = (since: number, sentAt: number, want: string) =>
    s.recs.slice(since).find((r) => r.type === want || (r.type === 'error' && r.t - sentAt <= 5000)) ?? null;
  const muted = reply(sinceMute, tMute, 'session.input_audio.muted');
  const unmuted = reply(sinceUnmute, tUnmute, 'session.input_audio.unmuted');
  const ins = deltasOf(s, IN_T);
  const outs = deltasOf(s, OUT_T);
  const lastA = A.marks[A.marks.length - 1];
  const m = M.marks[0];
  const b = B.marks[0];
  const inText = textOf(ins);
  const outText = textOf(outs);
  const heardM = m.heard.test(inText);
  const saidM = saidOk && m.said.test(outText);
  const heardB = b.heard.test(textOf(ins, tUnmute));
  const finishedA = finishedBy(outs, lastA, tUnmute);
  const ackLine = (r: Rec | null, sent: number, what: string) => (!r ? `no reply within the span to ${what}` : r.type === 'error' ? `refused: error ${errorLine(r)}` : `${r.type} ${ms(r.t - sent)} after it${Object.keys(r.e).length > 1 ? ` ${JSON.stringify(r.e)}` : ''}`);
  const measured = [
    `- ${costLine(s)}`,
    `- mute sent ${sec(tMute - clipStart)} into the clip: ${ackLine(muted, tMute, 'mute')}`,
    `- unmute sent ${sec(tUnmute - clipStart)}: ${ackLine(unmuted, tUnmute, 'unmute')}`,
    `- before mute, ${spanLine(s, clipStart, tMute)}`,
    `- muted (“${m.text}” appended, then silence), ${spanLine(s, tMute, tUnmute)}`,
    `- after unmute (“${b.text}”, then 10 s of silence), ${spanLine(s, tUnmute, s.sock?.t ?? run.now())}`,
    `- input text: “${clip1(inText.trim(), 300)}”`,
    `- output text: “${clip1(outText.trim(), 300)}”`,
    `- appended while muted: ${sec(tUnmute - tMute)} (${s.inputs.filter((x) => x.t > tMute && x.t <= tUnmute).length} appends, ${sec(M.ms)} of it speech); after unmute the second clip ran to ${sec(tB - clipStart)}`,
  ];
  const refused = muted?.type === 'error';
  const verdicts = [
    `U2 (ack): ${muted && !refused ? `session.input_audio.mute acknowledged — ${muted.type} in ${ms(muted.t - tMute)}` : refused ? `session.input_audio.mute refused — ${errorLine(muted!)}` : 'no acknowledgement of session.input_audio.mute'}; unmute: ${unmuted && unmuted.type !== 'error' ? `${unmuted.type} in ${ms(unmuted.t - tUnmute)}` : unmuted ? `refused — ${errorLine(unmuted)}` : 'no acknowledgement'}`,
    `U2 (pending translation): ${finishedA ? 'finished while muted' : 'did NOT finish while muted'} — “${lastA.text}”${saidOk ? ` (keyword ${lastA.said})` : ''} ${finishedA ? 'was translated before unmute' : 'had no finished translation by unmute'}`,
    `U2 (audio appended while muted): ${heardM || saidM ? `NOT ignored — “${m.text}” ${heardM ? 'appears in the input transcript' : ''}${heardM && saidM ? ' and ' : ''}${saidM ? 'was translated' : ''}` : `ignored — “${m.text}” appears in neither transcript`}${refused ? ' (mute was refused, so this measures an unmuted session)' : ''}`,
    `U2 (unmute): ${heardB ? `input resumed — “${b.text}” heard after unmute` : `“${b.text}” not heard after unmute`}`,
    `U2 (billing): across the ${sec(tUnmute - tMute)} muted, ${usageAcross(s, tMute, tUnmute).text}`,
  ];
  run.report(block(header('mute', [`- ${A.marks.length} sentences, then session.input_audio.mute {type, event_id} (the shape the docs name; no field list was captured), 20 s, unmute, one sentence, 10 s`]), measured, verdicts));
}

async function idleMode(): Promise<void> {
  const run = startRun(PROVIDER, 'idle', outDir);
  const s = await startedSession(run, 'idle');
  const t0 = run.now();
  await s.waitFor((r) => r.type === 'session.closed', idleMaxMs);
  const t1 = run.now();
  const serverClosed = s.closedFrame();
  const sockEarly = s.sock;
  await s.close();
  const cont = continuity(s);
  const us = usageOf(s).filter((u) => u.seconds !== null) as Array<{ t: number; seconds: number }>;
  const measured = [
    `- ${costLine(s)}`,
    `- no appends for ${sec(t1 - t0)} (cap ${sec(idleMaxMs)})`,
    `- output audio: ${continuityLine(cont)}`,
    `- output text deltas: ${deltasOf(s, OUT_T).length} “${clip1(textOf(deltasOf(s, OUT_T)).trim(), 200)}”; input deltas: ${deltasOf(s, IN_T).length}`,
    `- usage reports: ${us.map((u) => `${sec(u.t - t0)}: ${u.seconds}`).join(', ') || 'none'}`,
    `- server close: ${serverClosed ? `session.closed ${JSON.stringify(serverClosed.e)} at ${sec(serverClosed.t - t0)}` : 'none'}; socket ${sockEarly ? `closed ${sockEarly.code} ${sockEarly.reason} at ${sec(sockEarly.t - t0)}` : `still open at ${sec(t1 - t0)} (closed by the probe)`}`,
    ...errorsOf(s).map((r) => `- error at ${sec(r.t - t0)}: ${errorLine(r)}`),
  ];
  const advanced = us.length >= 2 && us[us.length - 1].seconds > us[0].seconds;
  const verdicts = [
    `U3 (frames): ${cont && cont.frames ? `audio frames flow with nothing appended — ${cont.frames} frames (${cont.floor} floor, ${cont.voiced} voiced), ${sec(cont.audioMs)} of audio over ${sec(cont.wallMs)}, the longest gap ${ms(cont.maxGap)}: ${cont.continuous && cont.maxGap <= 1000 ? 'a no-frame watchdog of a few seconds would work' : 'not continuous, so a no-frame watchdog would misfire'}` : 'no audio frames arrive without input: a no-frame watchdog cannot tell idle from dead'}`,
    `U3 (usage): ${us.length === 0 ? 'no usage reports' : advanced ? `usage advances with nothing appended — ${us[0].seconds} → ${us[us.length - 1].seconds} s over ${sec(us[us.length - 1].t - us[0].t)} (billing continues)` : `usage frozen at ${us[0].seconds} s across ${us.length} reports`}`,
    `U3 (server close): ${serverClosed ? `closed by the server after ${sec(serverClosed.t - (s.startedAt ?? t0))} — reason ${String(serverClosed.e.reason)}` : sockEarly ? `the socket closed after ${sec(sockEarly.t - (s.startedAt ?? t0))} (code ${sockEarly.code}) without session.closed` : `no server close within ${sec(t1 - t0)}`}`,
  ];
  run.report(block(header('idle', [`- session.start, then nothing appended, up to ${sec(idleMaxMs)}`]), measured, verdicts));
}

async function closeMode(): Promise<void> {
  const run = startRun(PROVIDER, 'close', outDir);
  const clip = await build(scripts().short);
  const s = await startedSession(run, 'close');
  const expires = num(s.started?.expires_at);
  const startedWall = s.startedWall ?? Date.now();
  await paceInto([s], clip.pcm);
  const c = await s.close();
  const wall = c.closed && s.startedAt !== null ? c.closed.t - s.startedAt : null;
  const b = billed(s);
  const after = c.closed ? s.recs.filter((r) => r.t > c.closed!.t) : [];
  const beforeClosed = c.sentAt !== null ? s.recs.filter((r) => r.t > c.sentAt! && (!c.closed || r.t < c.closed.t)) : [];
  const measured = [
    `- ${costLine(s)}`,
    `- session.started: ${clip1(JSON.stringify(s.started), 600)}`,
    `- expires_at ${expires ?? '—'}${expires !== null ? ` = ${sec(expires * 1000 - startedWall)} after session.started` : ''}`,
    `- ${clip.marks.length} sentences (${sec(clip.ms)}), then session.close at once: ${c.closed ? `session.closed ${JSON.stringify(c.closed.e)} ${ms(c.took)} later` : `no session.closed within ${CLOSE_WAIT_MS} ms`}; socket ${s.sock ? `closed ${s.sock.code} ${s.sock.reason} ${ms(c.sentAt !== null ? s.sock.t - c.sentAt : null)} after session.close` : '—'}`,
    `- between session.close and session.closed: ${beforeClosed.length} frames (${[...new Set(beforeClosed.map((r) => r.type))].join(', ') || 'none'}); after it: ${after.length}`,
  ];
  const verdicts = [
    `U7 (close): ${c.closed ? `session.close → session.closed (reason ${String(c.closed.e.reason)}) in ${ms(c.took)}; socket closed ${s.sock?.code ?? '—'}` : `no session.closed within ${CLOSE_WAIT_MS} ms of session.close`}`,
    `U7 (usage): ${b !== null && wall !== null ? `billed ${b} s against ${sec(wall)} from session.started to session.closed (difference ${(b - wall / 1000).toFixed(1)} s)` : 'no usage seconds reported'}`,
    `U7 (session limit): ${expires !== null ? `expires_at − now = ${Math.round(expires - startedWall / 1000)} s (${((expires - startedWall / 1000) / 60).toFixed(1)} min) at session.started` : 'session.started carries no expires_at'}`,
  ];
  run.report(block(header('close', [`- ${clip.marks.length} sentences, then session.close at once`]), measured, verdicts));
}

async function errorsMode(): Promise<void> {
  const run = startRun(PROVIDER, 'errors', outDir);
  const measured: string[] = [];
  const verdicts: string[] = [];
  // 1. An invalid voice at session.start.
  const bad = dial(run, 'errors', { leg: 'voice' });
  if (await bad.waitOpen(15_000)) {
    const st = await bad.start(sessionStart({ voice: 'probe-invalid-voice' }));
    await bad.idle(3000);
    const closedAfter = bad.sock;
    await bad.close();
    measured.push(`- invalid voice: session.start → ${st.outcome} in ${ms(st.ms)}${st.rec ? ` ${st.rec.type === 'error' ? errorLine(st.rec) : JSON.stringify(st.rec.e).slice(0, 300)}` : ''}; the socket ${closedAfter ? `closed by the server (code ${closedAfter.code} ${closedAfter.reason})` : 'stayed open 3 s (closed by the probe)'}; ${costLine(bad)}`);
    verdicts.push(st.outcome === 'error'
      ? `U10 (invalid voice): refused before session.started — error ${errorLine(st.rec!)}; the socket ${closedAfter ? `then closed (code ${closedAfter.code})` : 'stayed open'}`
      : st.outcome === 'started'
        ? 'U10 (invalid voice): accepted — session.started came back, the voice is not validated at session.start'
        : `U10 (invalid voice): no error frame — session.start → ${st.outcome}${bad.sock ? ` (socket ${bad.sock.code} ${bad.sock.reason})` : ''}`);
  } else {
    measured.push(`- invalid voice: the upgrade itself was refused (${bad.refused?.status ?? bad.sock?.code ?? 'timeout'})`);
    verdicts.push('U10 (invalid voice): not measured — the upgrade was refused');
  }
  // 2. Malformed appends mid-session.
  const clip = await build(scripts().short);
  const s = await startedSession(run, 'errors', sessionStart(), 'append');
  const lead = RATE; // one second of the clip first
  await paceInto([s], clip.pcm.subarray(0, lead));
  const probes: Array<{ name: string; frame: Record<string, unknown>; at: number; since: number; sent: boolean }> = [];
  for (const p of [
    { name: 'audio that is not base64', frame: { type: 'session.input_audio.append', audio: '@@@ not base64 @@@' } },
    { name: 'an odd byte count (3 bytes)', frame: { type: 'session.input_audio.append', audio: Buffer.from([1, 2, 3]).toString('base64') } },
  ]) {
    const since = s.recs.length;
    const at = run.now();
    const sent = s.send(p.frame);
    probes.push({ ...p, at, since, sent });
    await paceInto([s], silence(2000, RATE));
  }
  const afterAll = run.now();
  await paceInto([s], concat(clip.pcm.subarray(lead), silence(6000, RATE)));
  const aliveUntilClose = s.isOpen();
  await s.close();
  const insAfter = deltasOf(s, IN_T).filter((d) => d.t > afterAll);
  const outsAfter = deltasOf(s, OUT_T).filter((d) => d.t > afterAll);
  measured.push(`- malformed appends into a live session (${clip.marks.length} sentences around them): ${costLine(s)}`);
  for (const p of probes) {
    if (!p.sent) {
      measured.push(`  - ${p.name}: not sent, the socket was already closed (${s.sock?.code ?? '—'})`);
      verdicts.push(`U10 (append with ${p.name}): not sent — the session had already ended`);
      continue;
    }
    const e = s.recs.slice(p.since).find((r) => r.type === 'error' && r.t - p.at <= 2000) ?? null;
    const closed = s.recs.slice(p.since).find((r) => r.type === 'session.closed' && r.t - p.at <= 2000) ?? null;
    measured.push(`  - ${p.name}: ${e ? `error ${ms(e.t - p.at)} later ${errorLine(e)}` : 'no error within 2 s'}${closed ? `; session.closed ${JSON.stringify(closed.e)}` : ''}`);
    const ended = closed !== null || (s.sock !== null && s.sock.t <= p.at + 2000 && s.closeSentAt === null);
    verdicts.push(`U10 (append with ${p.name}): ${e ? `error ${errorLine(e)}` : 'no error (silently ignored)'}; ${ended ? `the session ended${closed ? ` (${String(closed.e.reason)})` : s.sock ? ` (socket ${s.sock.code})` : ''}` : `the session continues — ${insAfter.length} input and ${outsAfter.length} output deltas after the malformed appends`}`);
  }
  measured.push(`  - after both: ${insAfter.length} input deltas “${clip1(textOf(insAfter).trim(), 120)}”, ${outsAfter.length} output deltas; the socket was ${aliveUntilClose ? 'still open at the probe\'s close' : `already closed (${s.sock?.code ?? '—'})`}`);
  run.report(block(header('errors', ['- an invalid voice at session.start; then a live session given two malformed appends between real audio']), measured, verdicts));
}

async function bothMode(): Promise<void> {
  const run = startRun(PROVIDER, 'both', outDir);
  const clip = await build(scripts().short);
  const legs = ['a', 'b'].map((leg) => dial(run, 'both', { leg }));
  const opened = await Promise.all(legs.map((s) => s.waitOpen(15_000)));
  const starts = await Promise.all(legs.map((s, i) => (opened[i] ? s.start(sessionStart()) : Promise.resolve(null))));
  const live = legs.filter((_, i) => starts[i]?.outcome === 'started');
  if (live.length) {
    await paceInto(live, concat(clip.pcm, silence(8000, RATE)));
  }
  await Promise.all(legs.map((s) => s.close()));
  const measured = legs.map((s, i) => {
    const st = starts[i];
    return `- leg ${s.leg}: ${!opened[i] ? `upgrade refused ${s.refused?.status ?? s.sock?.code ?? 'timeout'}` : `session.start → ${st?.outcome} in ${ms(st?.ms)}${st?.rec?.type === 'error' ? ` ${errorLine(st.rec)}` : ''}`}; id ${String(s.started?.id ?? '—')}; `
      + `input ${deltasOf(s, IN_T).length} deltas “${clip1(textOf(deltasOf(s, IN_T)).trim(), 80)}”; output ${deltasOf(s, OUT_T).length} deltas “${clip1(textOf(deltasOf(s, OUT_T)).trim(), 80)}”; ${costLine(s)}`;
  });
  const ids = legs.map((s) => String(s.started?.id ?? ''));
  const verdict = live.length === 2
    ? `U11: two sessions ran at once on one key — ids ${ids[0] !== ids[1] ? 'differ' : 'are THE SAME'}; billed ${billed(legs[0]) ?? '—'} s and ${billed(legs[1]) ?? '—'} s; transcripts ${legs.map((s) => `${textOf(deltasOf(s, OUT_T)).trim().length} chars`).join(' and ')}${legs.some((s) => !words(textOf(deltasOf(s, OUT_T)))) ? ' (one leg translated nothing)' : ''}`
    : `U11: only ${live.length} of 2 sessions started — ${legs.map((s, i) => `${s.leg}: ${starts[i]?.outcome ?? 'no upgrade'}${starts[i]?.rec?.type === 'error' ? ` ${errorLine(starts[i]!.rec!)}` : ''}`).join('; ')}`;
  run.report(block(header('both', [`- two sessions on one key, dialled together; ${clip.marks.length} sentences (${sec(clip.ms)}) and 8 s of silence into both`]), measured, [verdict]));
}

const MODES: Record<string, () => Promise<void>> = {
  headers: headersMode, timeline: timelineMode, release: releaseMode, mute: muteMode, idle: idleMode, close: closeMode, errors: errorsMode, both: bothMode,
};

async function runMode(m: string): Promise<void> {
  try {
    await MODES[m]();
  } catch (err) {
    const run = startRun(PROVIDER, `${m}-failed`, outDir);
    run.report(`Mode ${m} failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

if (mode === 'all') {
  for (const m of ['headers', 'timeline', 'release', 'close', 'errors', 'both']) await runMode(m);
} else if (MODES[mode]) {
  await runMode(mode);
} else {
  console.error(`usage: live.mts <${[...Object.keys(MODES), 'all'].join('|')}> [--clip zh|ja] [--script user|tight|long] [--sentences N] [--target en] [--voice marin] [--delegation client|null] [--max 180] [--pause 1500] [--out dir] [--url ws…] [--offline --words file|dir]`);
  process.exit(2);
}
process.exit();
