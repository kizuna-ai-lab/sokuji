/**
 * OpenAI Translate (`gpt-realtime-translate`), dialled with the app's own wire
 * (`src/providers/openai_translate/wire.ts`): a spike for how the translation
 * side is cut into segments. It records one real session, then replays it
 * offline through today's rule and a proposed one, and checks whether each
 * translation segment's audio says what its text says.
 *
 *   OPENAI_API_KEY=… npx tsx scripts/dev/wire-probe/openai-translate.mts record [--script user|tight|long] [--target en]
 *     Synthesises the script's sentences (OpenAI TTS, cached), joins them with the script's pauses, streams
 *     them at real-time pace, then 10 s of silence. Writes `<stamp>-<script>.jsonl` (every frame's arrival and
 *     `elapsed_ms`), `<stamp>-<script>.out.pcm` (the output audio, 24 kHz PCM16) and the input clip as a wav.
 *   OPENAI_API_KEY=… npx tsx scripts/dev/wire-probe/openai-translate.mts analyze --run <stamp>-<script>
 *     Today's rule (each side closed by its own 1.5 s silence; L2 pairs by 4 s proximity) against the proposed
 *     one (the translation cut at its n-th sentence end after each source cut, guarded by `elapsed_ms`;
 *     stated pairs), and two audio hand-offs at a cut: by arrival, or at the first quiet frame. Transcribes
 *     the output audio once (whisper-1, word timestamps) to say which words each segment's audio holds.
 *     `GUARD=arrival` guards the cut by arrival time instead of `elapsed_ms` (the rule Gemini Live Translate,
 *     which stamps nothing, would use); `TRACE=1` prints every close of the proposed rule.
 *
 * The rule as proposed, and what the first spike (2026-09-30) settled: the translation segment is cut at
 * its n-th sentence end after each source cut (n = the source segment's sentence ends, at least one), the
 * sentence end arriving after the source's last delta; a translation that stops mid-sentence is held up to
 * 5 s; audio goes to the segment open at its arrival. Three sessions, 19 source segments: today's rule
 * paired 12 and left 5 fragments orphaned, the proposed one paired 19 with none, by either guard.
 *
 * Credentials come from the environment only and are never printed or written.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { REPO, args, concat, pace, secret, silence, sleep, startRun, stamp, writeWav } from './common.mts';

const RATE = 24_000;
const DIR = path.join(REPO, '.superpowers/wire-probes/openai-translate');
const PAUSE_MS = 1500;
const PROXIMITY_MS = 4000;
const QUIET_RMS = 0.002;
const MID_HOLD_MS = 5000;

const S = {
  a: '今天我吃了一家不错的牛肉面，老板好像是四川人，反正肯定不是日本人。',
  b: '店里的装修不错，一个吧台铺满了辣椒，店里的海报也贴得很好，不是随便贴贴的。',
  c: '看起来十分用心。',
  d: '下午快接近吃饭的时间有三四个客人，就老板一个人也忙活得过来。',
  e: '排骨有点薄，但是炸的面衣不错，适合泡在汤里吃。',
  f: '店里的贩卖机竟然不支持新的一千和五百日元。',
  g: '吃完以后我在附近的公园走了一会儿。',
  h: '天气有点冷，但是空气很好。',
};
/** Sentences and pauses (ms) in order: the owner's session (`user`), every pause just over the source's 1.5 s (`tight`), and a longer mix. */
const SCRIPTS: Record<string, Array<string | number>> = {
  user: [500, S.a, 2400, S.b, 400, S.c, 2200, S.d, 1800, S.e, 1400, S.f],
  tight: [500, S.a, 1700, S.b, 1700, S.c, 1700, S.d, 1700, S.e, 1700, S.f],
  long: [500, S.a, 2400, S.b, 400, S.c, 2200, S.d, 1800, S.e, 1400, S.f, 2000, S.g, 900, S.h],
};

const key = secret(process.env.OPENAI_API_KEY);

async function tts(text: string): Promise<Int16Array> {
  const file = path.join(DIR, 'tts', `${crypto.createHash('sha1').update(text).digest('hex')}.pcm`);
  if (!fs.existsSync(file)) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm', instructions: 'Speak natural Mandarin Chinese at a normal conversational pace.' }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const b = fs.readFileSync(file);
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2)));
}

function rmsOf(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / pcm.length) / 32768;
}
const allZero = (pcm: Int16Array) => pcm.every((x) => x === 0);

// ---------- record ----------

async function record(scriptName: string, target: string): Promise<void> {
  const script = SCRIPTS[scriptName];
  if (!script) throw new Error(`no script ${scriptName}`);
  const parts: Int16Array[] = [];
  const marks: Array<{ text: string; startMs: number; endMs: number }> = [];
  let at = 0;
  for (const p of script) {
    if (typeof p === 'number') { parts.push(silence(p, RATE)); at += p; continue; }
    const pcm = await tts(p);
    parts.push(pcm);
    const ms = (pcm.length / RATE) * 1000;
    marks.push({ text: p, startMs: Math.round(at), endMs: Math.round(at + ms) });
    at += ms;
  }
  parts.push(silence(10_000, RATE));
  const clip = concat(...parts);
  const run = startRun('openai-translate', scriptName, DIR);
  const base = path.join(DIR, `${stamp()}-${scriptName}`);
  writeWav(`${base}.in.wav`, clip, RATE);
  const out = fs.openSync(`${base}.out.pcm`, 'w');
  let outSamples = 0;
  run.log('note', 'script', { script: scriptName, target, sentences: marks });

  const ws = new WebSocket(`wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`, ['realtime', `openai-insecure-api-key.${key}`]);
  let closed = false;
  let updated: () => void = () => {};
  const ready = new Promise<void>((r) => { updated = r; });
  ws.on('message', (data) => {
    const t = run.now();
    let e: Record<string, unknown>;
    try { e = JSON.parse(String(data)); } catch { run.log('in', 'unparsable'); return; }
    const type = String(e.type);
    const elapsed = typeof e.elapsed_ms === 'number' ? e.elapsed_ms : null;
    if (type === 'session.output_audio.delta' && typeof e.delta === 'string') {
      const b = Buffer.from(e.delta, 'base64');
      const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
      fs.writeSync(out, b);
      run.log('in', type, { t, elapsed, off: outSamples, len: pcm.length, rms: Math.round(rmsOf(pcm) * 1e5) / 1e5, zero: allZero(pcm) });
      outSamples += pcm.length;
      return;
    }
    if (type.endsWith('.delta')) { run.log('in', type, { t, elapsed, delta: e.delta }); return; }
    run.log('in', type, { t, elapsed, detail: type === 'error' ? e.error : undefined });
    if (type === 'session.created') {
      ws.send(JSON.stringify({ type: 'session.update', session: { audio: { output: { language: target }, input: { transcription: { model: 'gpt-live-transcribe' }, noise_reduction: null } } } }));
    }
    if (type === 'session.updated') updated();
  });
  ws.on('close', (code) => { closed = true; run.log('ws', 'close', { code }); });
  ws.on('error', (err) => run.log('ws', 'error', { message: String(err) }));
  await Promise.race([ready, sleep(30_000)]);
  if (closed) throw new Error('closed before the session was updated');
  run.log('note', 'streaming', { t: run.now() });
  const clipStart = run.now();
  await pace(clip, RATE, 100, (chunk) => {
    ws.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64') }));
  }, () => closed);
  run.log('note', 'clip_end', { t: run.now(), clipStart });
  ws.close();
  await sleep(500);
  fs.closeSync(out);
  console.log(`recorded ${base}.jsonl (${(outSamples / RATE).toFixed(1)} s of output audio)`);
}

// ---------- analyze ----------

interface Ev { t: number; type: string; elapsed: number | null; delta?: string; off?: number; len?: number; rms?: number; zero?: boolean }

function load(runName: string): { evs: Ev[]; out: Int16Array; sentences: Array<{ text: string }> } {
  const lines = fs.readFileSync(path.join(DIR, `${runName}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const evs: Ev[] = [];
  let sentences: Array<{ text: string }> = [];
  for (const l of lines) {
    if (l.type === 'script') sentences = l.d.sentences;
    if (l.dir !== 'in' || !l.d) continue;
    evs.push({ t: l.d.t ?? l.t, type: l.type, elapsed: l.d.elapsed ?? null, delta: l.d.delta, off: l.d.off, len: l.d.len, rms: l.d.rms, zero: l.d.zero });
  }
  const b = fs.readFileSync(path.join(DIR, `${runName}.out.pcm`));
  return { evs, out: new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2))), sentences };
}

interface Seg { id: number; side: 'source' | 'translation'; openedAt: number; text: string; origin?: number; frames: number[]; closedAt?: number }

/** A CJK full stop, question or exclamation mark ends a sentence wherever it stands; a Latin one only before a space or the end (not "1.5", not "U.S"). */
const sentenceEnds = (s: string) => (s.match(/[。？！]/g) ?? []).length + (s.match(/[.?!](?=\s|$)/g) ?? []).length;

/** A pure replay of one rule over the recorded events; the translation's audio frames are assigned by `hand`. */
function simulate(evs: Ev[], rule: 'today' | 'proposed', hand: 'arrival' | 'quiet' | 'either'): Seg[] {
  const segs: Seg[] = [];
  const open: Record<'source' | 'translation', Seg | null> = { source: null, translation: null };
  const deadline: Record<'source' | 'translation', number | null> = { source: null, translation: null };
  let ids = 0;
  // Proposed: one owed cut per closed source segment.
  const owed: Array<{ ref: number; n: number; lastElapsed: number }> = [];
  let sourceLastElapsed = 0;
  let sentencesSinceOpen = 0;
  let cutPending = false;
  /** Audio still owed to the segment a cut just closed ('quiet' hand-off). */
  let tailTo: Seg | null = null;
  let tailSince = 0;

  const ensure = (side: 'source' | 'translation', t: number): Seg => {
    if (open[side]) return open[side]!;
    const s: Seg = { id: ++ids, side, openedAt: t, text: '', frames: [] };
    segs.push(s);
    open[side] = s;
    if (side === 'translation') sentencesSinceOpen = 0;
    return s;
  };
  const close = (side: 'source' | 'translation', t: number) => {
    const s = open[side];
    if (!s) return;
    if (process.env.TRACE && rule === 'proposed' && hand === 'arrival') console.error(`close ${side} ${s.id} at ${t} owed=${JSON.stringify(owed)} since=${sentencesSinceOpen} pending=${cutPending} text=${JSON.stringify(s.text.slice(-24))}`);
    s.closedAt = t;
    open[side] = null;
    deadline[side] = null;
    if (side === 'source' && rule === 'proposed') {
      owed.push({ ref: s.id, n: Math.max(1, sentenceEnds(s.text)), lastElapsed: sourceLastElapsed });
      checkOwed();
    }
    if (side === 'translation' && rule === 'proposed') {
      if (s.origin === undefined && owed.length) s.origin = owed.shift()!.ref;
      cutPending = false;
    }
  };
  let lastTrSentenceElapsed = 0;
  const checkOwed = () => {
    const tr = open.translation;
    if (!tr || !owed.length || cutPending) return;
    if (sentencesSinceOpen >= owed[0].n && lastTrSentenceElapsed > owed[0].lastElapsed) cutPending = true;
  };
  /** Proposed: a translation that stops mid-sentence is the interpreter waiting for the source — held up to MID_HOLD_MS of quiet. */
  let trLastT = 0;
  let trExtended = false;
  const fire = (t: number) => {
    for (const side of ['source', 'translation'] as const) {
      const d = deadline[side];
      if (d === null || d > t) continue;
      const tr = open.translation;
      if (side === 'translation' && rule === 'proposed' && tr && !trExtended && !/[.?!。？！]\s*$/.test(tr.text)) {
        trExtended = true;
        deadline.translation = trLastT + MID_HOLD_MS;
        if (deadline.translation <= t) close(side, deadline.translation);
        continue;
      }
      close(side, d);
    }
  };
  /** A cut at its owed point: the old segment states its source and closes; the next text or audio opens the next one. */
  const cutNow = (t: number): Seg => {
    const old = open.translation!;
    old.origin = owed.shift()!.ref;
    cutPending = false;
    close('translation', t);
    return old;
  };

  for (const e of evs) {
    fire(e.t);
    if (e.type === 'session.input_transcript.delta' && e.delta) {
      const s = ensure('source', e.t);
      s.text += e.delta;
      if (process.env.GUARD === 'arrival') sourceLastElapsed = e.t;
      else if (e.elapsed !== null) sourceLastElapsed = e.elapsed;
      deadline.source = e.t + PAUSE_MS;
    } else if (e.type === 'session.output_transcript.delta' && e.delta) {
      if (rule === 'proposed' && cutPending && open.translation) {
        const old = cutNow(e.t);
        if (hand === 'quiet') { tailTo = old; tailSince = e.t; }
      }
      const s = ensure('translation', e.t);
      s.text += e.delta;
      const ends = sentenceEnds(e.delta);
      if (ends) { sentencesSinceOpen += ends; if (process.env.GUARD === 'arrival') lastTrSentenceElapsed = e.t; else if (e.elapsed !== null) lastTrSentenceElapsed = e.elapsed; }
      deadline.translation = e.t + PAUSE_MS;
      trLastT = e.t;
      trExtended = false;
      if (rule === 'proposed') checkOwed();
    } else if (e.type === 'session.output_audio.delta' && e.len) {
      const quietFrame = e.zero || (e.rms ?? 0) < QUIET_RMS;
      // Either: at the owed point, the first quiet frame hands over as the next text delta would.
      if (rule === 'proposed' && hand === 'either' && cutPending && open.translation && quietFrame) cutNow(e.t);
      if (e.zero) continue; // a heartbeat, as the adapter drops it
      const content = rule === 'today' ? true : (e.rms ?? 0) >= QUIET_RMS;
      if (content) { trLastT = e.t; trExtended = false; }
      if (tailTo) {
        // Quiet hand-off: the closed segment keeps the audio until a quiet frame (or 3 s after the cut).
        if (!content || e.t - tailSince > 3000) tailTo = null;
        else { tailTo.frames.push(e.off!); continue; }
      }
      if (!content && !open.translation) continue;
      const s = ensure('translation', e.t);
      s.frames.push(e.off!);
      if (content) deadline.translation = e.t + PAUSE_MS;
    }
  }
  fire(Number.POSITIVE_INFINITY);
  close('source', Number.POSITIVE_INFINITY);
  close('translation', Number.POSITIVE_INFINITY);
  if (rule === 'today') inferPairs(segs);
  return segs;
}

/** L2's inference as `src/lib/projection/pair.ts` has it, untimed: proximity by opening. */
function inferPairs(segs: Seg[]): void {
  const sources = segs.filter((s) => s.side === 'source');
  const taken = new Set<number>();
  for (const tr of segs.filter((s) => s.side === 'translation')) {
    let best: Seg | undefined;
    let score = -Infinity;
    for (const src of sources) {
      if (taken.has(src.id)) continue;
      const gap = tr.openedAt - src.openedAt;
      if (gap < 0 || gap > PROXIMITY_MS) continue;
      const sc = 1 - gap / PROXIMITY_MS;
      if (sc > score) { score = sc; best = src; }
    }
    if (best) { tr.origin = best.id; taken.add(best.id); }
  }
}

interface Word { word: string; start: number; end: number }

async function words(out: Int16Array, cacheFile: string): Promise<Word[]> {
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const tmp = `${cacheFile}.wav`;
  writeWav(tmp, out, RATE);
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(tmp)], { type: 'audio/wav' }), 'out.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', 'en');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const w = ((await res.json()) as { words?: Word[] }).words ?? [];
  fs.writeFileSync(cacheFile, JSON.stringify(w));
  return w;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim().split(/\s+/).filter(Boolean);

async function analyze(runName: string): Promise<void> {
  const { evs, out } = load(runName);
  // The played stream is every frame that is not all zero, in arrival order: a word's time in it maps to the frame that holds it.
  const played: Array<{ off: number; len: number; at: number }> = [];
  let at = 0;
  for (const e of evs) if (e.type === 'session.output_audio.delta' && e.len && !e.zero) { played.push({ off: e.off!, len: e.len, at }); at += e.len; }
  const playedPcm = concat(...played.map((p) => out.subarray(p.off, p.off + p.len)));
  const ws = await words(playedPcm, path.join(DIR, `${runName}.words.json`));
  const frameOfWord = (w: Word) => {
    const s = ((w.start + w.end) / 2) * RATE;
    const p = played.find((x) => s >= x.at && s < x.at + x.len);
    return p ? p.off : -1;
  };
  const wordFrames = ws.map((w) => ({ w: w.word, off: frameOfWord(w) }));

  const lines: string[] = [];
  const show = (title: string, segs: Seg[], withAudio: boolean) => {
    lines.push(`### ${title}`, '');
    const src = segs.filter((s) => s.side === 'source');
    const tr = segs.filter((s) => s.side === 'translation');
    const byOrigin = new Map<number, Seg[]>();
    for (const t of tr) if (t.origin !== undefined) byOrigin.set(t.origin, [...(byOrigin.get(t.origin) ?? []), t]);
    let paired = 0;
    for (const s of src) {
      const ts = byOrigin.get(s.id) ?? [];
      if (ts.length) paired += 1;
      lines.push(`- **source ${s.id}**: ${s.text}`);
      if (!ts.length) lines.push('  - → (no translation)');
      for (const t of ts) {
        lines.push(`  - → ${t.text.trim()}`);
        if (withAudio) {
          const heard = wordFrames.filter((x) => t.frames.includes(x.off)).map((x) => x.w).join(' ');
          const textW = norm(t.text);
          const heardW = norm(heard);
          const missing = textW.filter((w) => !heardW.includes(w)).length;
          const extra = heardW.filter((w) => !textW.includes(w)).length;
          lines.push(`    - audio: ${heard || '(none)'}  — ${t.frames.length} frames; text words missing from its audio ${missing}, audio words not in its text ${extra}`);
        }
      }
    }
    const orphan = tr.filter((t) => t.origin === undefined);
    for (const t of orphan) lines.push(`- **unpaired translation**: ${t.text.trim()}`);
    lines.push('', `Sources ${src.length}, translations ${tr.length}, sources with a translation ${paired}.`, '');
  };
  show('Today: each side by its own 1.5 s silence; L2 pairs by 4 s proximity', simulate(evs, 'today', 'arrival'), true);
  show('Proposed, audio handed over by arrival', simulate(evs, 'proposed', 'arrival'), true);
  show('Proposed, audio handed over at the first quiet frame', simulate(evs, 'proposed', 'quiet'), true);
  show('Proposed, handed over at the next text delta or the first quiet frame, whichever first', simulate(evs, 'proposed', 'either'), true);

  // Audio against text: when does a translation sentence's last word arrive as text, and as audio?
  lines.push('### Text against audio at each translation sentence end', '');
  const outDeltas = evs.filter((e) => e.type === 'session.output_transcript.delta' && e.delta);
  const frameArrival = new Map<number, number>();
  for (const e of evs) if (e.type === 'session.output_audio.delta' && e.off !== undefined) frameArrival.set(e.off, e.t);
  let wi = 0;
  let acc = '';
  for (let i = 0; i < outDeltas.length; i++) {
    const d = outDeltas[i];
    acc += d.delta!;
    if (!sentenceEnds(d.delta!)) continue;
    const lastWord = norm(acc).pop();
    acc = '';
    if (!lastWord) continue;
    while (wi < wordFrames.length && norm(wordFrames[wi].w)[0] !== lastWord) wi++;
    if (wi >= wordFrames.length) { wi = 0; continue; }
    const audioAt = frameArrival.get(wordFrames[wi].off);
    const next = outDeltas[i + 1];
    lines.push(`- "${lastWord}": text ${d.t} ms, its audio frame arrived ${audioAt ?? '?'} ms (${audioAt !== undefined ? audioAt - d.t : '?'} ms after), next text delta ${next ? next.t : '—'} ms`);
    wi++;
  }
  const run = startRun('openai-translate', `${runName}-analysis`, DIR);
  run.report(lines.join('\n'));
}

const a = args();
if (!key) { console.error('OPENAI_API_KEY is not set'); process.exit(1); }
if (a.step === 'record') await record(a.opt('script') ?? 'user', a.opt('target') ?? 'en');
else if (a.step === 'analyze') await analyze(a.opt('run') ?? '');
else console.error('usage: record [--script user|tight|long] | analyze --run <stamp>-<script>');
