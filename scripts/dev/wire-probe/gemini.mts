/**
 * Gemini Live, dialled with the app's own wire (`src/providers/gemini/wire.ts`):
 * the model list the app's check reads, then one session per model kind —
 * the default dialogue model and, when the key lists one, Live Translate —
 * each fed a Japanese clip twice at real-time pace. It records when every
 * audio chunk and every output-transcription delta arrives, and per turn
 * answers the karaoke question: how does the text's arrival line up with the
 * audio's, and how far would an arrival alignment (OpenAI's) or an even
 * interpolation be from each other.
 *
 *   GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts [dialogue|translate|both] [--model <id>] [--src ja --dst en] [--gap <ms>]
 *     [--activity-handling NO_INTERRUPTION|START_OF_ACTIVITY_INTERRUPTS] [--turn-coverage TURN_INCLUDES_ONLY_ACTIVITY|TURN_INCLUDES_ALL_INPUT]
 *   GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts translate --manual
 *     Push-to-talk, as the app sends it: detection off, activityStart / the utterance / activityEnd,
 *     and no audio between presses.
 *   GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts overlap [--models a,b] [--gap 1500]
 *     The overlap matrix: the second utterance starts while the model still speaks the first's
 *     translation, under each activity handling × turn coverage; counts whether both utterances
 *     were heard and translated in full.
 *   GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts hold [--models a,b] [--gaps 300,600,900,1200,1500]
 *     [--policy none|generation|turn] [--begin activity_end|input|output] [--release burst|frames|paced] [--pace 4]
 *     [--hold-min <ms>] [--hold-max 8000] [--activity-handling …] [--turn-coverage …] [--manual] [--clip long]
 *     "Variant B" of the no-drop research (`gemini-hold.mts`): per model and gap, the utterance twice at
 *     real-time pace, every 100 ms chunk routed through a local hold. `generation` holds from the user's
 *     turn close to the answer's generationComplete, `turn` to its turnComplete; `none` is today's
 *     behaviour. The report adds each turn's cut class, each utterance heard/translated whole or not,
 *     the latencies, and a pass/fail line. Every list option takes comma-separated values: one session
 *     per combination (models × handlings × policies × begins × releases × gaps).
 *
 * Every mode logs each server message's top-level and serverContent keys
 * (`msg`) and, verbatim, every key it does not otherwise read
 * (`voiceActivity`, `interimInputTranscription`, `turnCompleteReason`,
 * `interactionStatus`, `top.<key>`, `sc.<key>`, `modelTurn.part`), so a field
 * Google adds is never dropped silently; each report ends with their tally.
 *
 * Offline validation only: `GEMINI_PROBE_ENDPOINT=http://127.0.0.1:<port>`
 * dials a loopback stand-in instead of Google (refused for any other host:
 * the key is sent to it) and writes under `.superpowers/wire-probes/gemini-fake/`;
 * `--out <dir>` writes anywhere else.
 */
import WebSocket from 'ws';
import { GEMINI_MODELS_URL, checkGemini, createGeminiCheck } from '../../../src/providers/gemini/check';
import type { GeminiConfig } from '../../../src/providers/gemini/config';
import {
  GEMINI_DEFAULT_VOICE, GEMINI_DEFAULTS, defaultGeminiModel, geminiActivityHandling, geminiLanguageName, isGeminiTranslateModel,
} from '../../../src/providers/gemini/settings';
import { ACTIVITY_END, ACTIVITY_START, GEMINI_LIVE_URL, audioFrame, base64ToPcm, decodeServerMessage, liveUrl, pcmRate, setupFrame } from '../../../src/providers/gemini/wire';
import { resolveInstructions } from '../../../src/lib/provider/instructions';
import { CLIPS, args, concat, pace, readWav, secret, silence, sleep, startRun, writeWav, type Run } from './common.mts';
import {
  BEGINS, POLICIES, RELEASES, createHold, holdReport, longClip, timeline, whereIn,
  type EndFlag, type Hold, type HoldOptions, type Utterance,
} from './gemini-hold.mts';

const INPUT_RATE = 24000;
const CHUNK_MS = 100;
/** A Live Translate "turn" (it has none): output separated from the next by this much quiet. */
const TRANSLATE_GAP_MS = 2000;

const key = secret(process.env.GEMINI_API_KEY);
if (!key) {
  console.error('Set GEMINI_API_KEY.');
  process.exit(2);
}
/** Offline validation only (see the header): a loopback stand-in for Google. Unset, the probe dials Google's own endpoints. */
const endpoint = process.env.GEMINI_PROBE_ENDPOINT?.replace(/\/+$/, '');
if (endpoint && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname)) {
  console.error('GEMINI_PROBE_ENDPOINT must be a loopback address (127.0.0.1, localhost, [::1]): the key is sent to it.');
  process.exit(2);
}
const dialUrl = (): string => (endpoint ? liveUrl(key).replace(new URL(GEMINI_LIVE_URL).origin, endpoint.replace(/^http/, 'ws')) : liveUrl(key));
const check = endpoint
  ? createGeminiCheck({ fetch: (input, init) => fetch(String(input).replace(new URL(GEMINI_MODELS_URL).origin, endpoint), init) })
  : checkGemini;
const PROVIDER = endpoint ? 'gemini-fake' : 'gemini';

const { step, opt } = args();
const kinds = step === 'dialogue' || step === 'translate' ? [step] : ['dialogue', 'translate'];
const gapMs = Number(opt('gap') ?? (step === 'overlap' ? 1500 : 2500));
const manual = process.argv.includes('--manual');
// The app's own codes (Gemini/AST2 follow-up, ruling 6): Google's, which Live Translate takes as they are.
const src = opt('src') ?? 'ja';
const dst = opt('dst') ?? 'en';
const outDir = opt('out');

interface Arrival { t: number; kind: 'audio' | 'text'; samples?: number; rate?: number; chars?: number }
interface Turn {
  index: number; events: Arrival[]; text: string; input: string; audio: Int16Array[]; rate: number; end?: string;
  /** Run times of this turn's `generationComplete` and `interrupted`, when they came. */
  gen?: number; interrupted?: number;
}

const sec = (ms: number | undefined) => (ms === undefined ? '-' : `${(ms / 1000).toFixed(2)} s`);

function analyse(turn: Turn): string {
  const audio = turn.events.filter((e) => e.kind === 'audio');
  const texts = turn.events.filter((e) => e.kind === 'text');
  const total = audio.reduce((n, e) => n + (e.samples ?? 0), 0);
  const L = turn.text.length;
  const t0 = turn.events[0]?.t ?? 0;
  const rel = (t: number | undefined) => (t === undefined ? '-' : `${((t - t0) / 1000).toFixed(2)} s`);
  const charsAt = (t: number) => texts.filter((e) => e.t <= t).reduce((n, e) => n + (e.chars ?? 0), 0);
  const lines: string[] = [];
  lines.push(`**Turn ${turn.index}** (${turn.end ?? 'open'}) — source: “${turn.input.trim()}” → translation: “${turn.text.trim()}”`);
  lines.push('');
  lines.push(`- audio: ${audio.length} chunks, ${(total / turn.rate).toFixed(2)} s at ${turn.rate} Hz; text: ${texts.length} deltas, ${L} chars`);
  lines.push(`- first audio ${rel(audio[0]?.t)}, last audio ${rel(audio.at(-1)?.t)}; first text ${rel(texts[0]?.t)}, last text ${rel(texts.at(-1)?.t)} (from the turn's first output)`);
  if (total === 0 || L === 0) {
    lines.push(cutLine(turn));
    return lines.join('\n');
  }

  // Arrival lens: when q% of the turn's audio had arrived, how much of the text had.
  const byArrival: string[] = [];
  let cum = 0;
  let q = 1;
  for (const e of audio) {
    cum += e.samples ?? 0;
    while (q <= 10 && cum >= (total * q) / 10) {
      byArrival.push(`${q * 10}%→${Math.round((100 * charsAt(e.t)) / L)}%`);
      q += 1;
    }
  }
  lines.push(`- when this much audio had arrived → this much text had: ${byArrival.join(' ')}`);

  // Playback lens: playback from the first chunk's arrival, in real time (no underrun assumed).
  const a0 = audio[0].t;
  const dur = (total / turn.rate) * 1000;
  const byPlayback = Array.from({ length: 10 }, (_, i) => `${(i + 1) * 10}%→${Math.round((100 * charsAt(a0 + (dur * (i + 1)) / 10)) / L)}%`);
  lines.push(`- when playback reached this much of the audio → this much text had arrived: ${byPlayback.join(' ')}`);

  // What an arrival alignment would light for each chunk, against an even interpolation.
  let c = 0;
  let diff = 0;
  let ahead = 0;
  for (const e of audio) {
    c += e.samples ?? 0;
    const arrival = Math.min(L, charsAt(e.t));
    const even = (L * c) / total;
    diff += Math.abs(arrival - even);
    if (arrival > even) ahead += 1;
  }
  lines.push(`- arrival alignment vs even interpolation: mean distance ${((100 * diff) / audio.length / L).toFixed(1)}% of the text per chunk; arrival ahead of even on ${ahead}/${audio.length} chunks`);
  lines.push(cutLine(turn));
  return lines.join('\n');
}

/** The turn's cut (research §2.7 P2): `true` when `interrupted` came with no `generationComplete` before it, `simulated` after it, `none` without one. */
function cutLine(turn: Turn): string {
  const cls = turn.interrupted === undefined ? 'none' : turn.gen !== undefined && turn.gen <= turn.interrupted ? 'simulated' : 'true';
  return `- cut: ${cls} (generationComplete ${sec(turn.gen)}, interrupted ${sec(turn.interrupted)}, run clock)`;
}

interface Variant { activityHandling?: string; turnCoverage?: string }

/** Both utterances heard and translated? The clip's two halves, counted over every turn. */
function coverage(turns: Turn[]): string {
  const input = turns.map((x) => x.input).join(' ');
  const output = turns.map((x) => x.text).join(' ').toLowerCase();
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  return `heard: first half ×${count(input, /ようこそ/g)}, second half ×${count(input, /手伝い/g)}; translated: first half ×${count(output, /welcome/g)}, second half ×${count(output, /conversation/g)} (a full run is ×2 each)`;
}

// ---------- every server key (research §2.7 P1) ----------

/** The keys the handler reads by name; any other is logged verbatim as `top.<key>` / `sc.<key>`. */
const KNOWN_TOP = new Set(['setupComplete', 'serverContent', 'usageMetadata', 'sessionResumptionUpdate', 'goAway', 'voiceActivity']);
const KNOWN_SC = new Set([
  'modelTurn', 'outputTranscription', 'inputTranscription', 'turnComplete', 'generationComplete', 'interrupted', 'waitingForInput',
  'interimInputTranscription', 'turnCompleteReason', 'interactionStatus',
]);
/** The end flags in their semantic order, which the hold is fed in (the log keeps the old order). */
const END_ORDER: readonly EndFlag[] = ['generationComplete', 'interrupted', 'turnComplete', 'waitingForInput'];

/** A value as it came, cut at 4000 characters of JSON. */
function verbatim(v: unknown): unknown {
  const s = JSON.stringify(v);
  return s !== undefined && s.length > 4000 ? `${s.slice(0, 4000)}… (${s.length} chars)` : v;
}

interface Wire {
  top: Map<string, number>;
  sc: Map<string, number>;
  va: Array<{ t: number; type?: string; offsetMs?: number }>;
  /** Between an ACTIVITY_START and its ACTIVITY_END. */
  vaOpen: boolean;
  inputs: Array<{ t: number; text: string; finished?: boolean; vaOpen: boolean }>;
  /** inputTranscription messages per run of them with no model output or end flag between: a run of more than one is "in pieces". */
  groups: number[];
  grouping: boolean;
  interim: number;
  values: Map<string, string[]>;
  ends: Array<{ t: number; flag: string; open: boolean }>;
}

function wireReport(w: Wire): string {
  const tally = (m: Map<string, number>) => [...m].map(([k, n]) => `${k} ×${n}`).join(', ') || '-';
  const fin = (v: boolean | undefined) => w.inputs.filter((p) => p.finished === v).length;
  const values = [...w.values].map(([k, vs]) => `${k}: ${[...new Set(vs)].map((v) => `${v} ×${vs.filter((x) => x === v).length}`).join(', ')}`);
  return [
    '**Server keys** (P1)',
    '',
    `- top-level: ${tally(w.top)}`,
    `- serverContent: ${tally(w.sc)}`,
    `- voiceActivity: ${w.va.length ? w.va.map((v) => `${v.type ?? '?'} at ${sec(v.t)}${v.offsetMs !== undefined ? ` (audioOffset ${sec(v.offsetMs)})` : ''}`).join(', ') : 'none'}`,
    `- inputTranscription: ${w.inputs.length} message(s) in ${w.groups.length} run(s) between model outputs [${w.groups.join(', ')}] — ${w.groups.some((n) => n > 1) ? '**in pieces**' : 'not in pieces'}; ${w.inputs.filter((p) => p.vaOpen).length} arrived while voice activity was open; finished true ×${fin(true)}, false ×${fin(false)}, absent ×${fin(undefined)}`,
    `- interimInputTranscription ×${w.interim}; waitingForInput ×${w.ends.filter((e) => e.flag === 'waitingForInput').length}${values.length ? `; ${values.join('; ')}` : ''}`,
  ].join('\n');
}

interface Probe { hold?: HoldOptions; name?: string }

async function session(kind: 'dialogue' | 'translate', model: string, variant: Variant = {}, probe: Probe = {}): Promise<void> {
  const tag = [variant.activityHandling, variant.turnCoverage].filter(Boolean).map((v) => v!.replace(/^(TURN_INCLUDES_|START_OF_ACTIVITY_)/, '').toLowerCase()).join('+');
  const run: Run = startRun(PROVIDER, probe.name ?? `${kind}-${model.replace(/[^a-z0-9.-]+/gi, '_')}${tag ? `-${tag}` : ''}`, outDir);
  const dialogue = kind === 'dialogue';
  const gap = probe.hold?.gapMs ?? gapMs;
  const config: GeminiConfig = {
    model,
    kind,
    instructions: resolveInstructions(GEMINI_DEFAULTS, { participant: false, source: geminiLanguageName(src), target: geminiLanguageName(dst) }),
    ...(dialogue ? { voice: GEMINI_DEFAULT_VOICE, temperature: GEMINI_DEFAULTS.temperature } : { translationTargetCode: dst }),
    activity: manual
      ? { manual: true }
      : { manual: false, start: GEMINI_DEFAULTS.vadStartSensitivity, end: GEMINI_DEFAULTS.vadEndSensitivity, silenceMs: GEMINI_DEFAULTS.vadSilenceDurationMs, prefixMs: GEMINI_DEFAULTS.vadPrefixPaddingMs },
    // The app's own rule; `--activity-handling` still overrides it below.
    activityHandling: geminiActivityHandling(model),
  };
  const setup = setupFrame(config, null);
  const ric = setup.setup.realtimeInputConfig as Record<string, unknown>;
  if (variant.activityHandling) ric.activityHandling = variant.activityHandling;
  if (variant.turnCoverage) ric.turnCoverage = variant.turnCoverage;
  run.log('note', 'config', { kind, model, src, dst, setup: { ...setup, setup: { ...setup.setup, systemInstruction: setup.setup.systemInstruction ? '<the app template>' : undefined } } });

  const ws = new WebSocket(dialUrl());
  let closed: { code: number; reason: string } | null = null;
  const isClosed = () => closed !== null;
  const turns: Turn[] = [];
  let turn: Turn | null = null;
  let lastOutput = 0;
  let setupDone = false;
  let pendingInput = '';
  const wire: Wire = { top: new Map(), sc: new Map(), va: [], vaOpen: false, inputs: [], groups: [], grouping: false, interim: 0, values: new Map(), ends: [] };
  // The hold mode's: made when its stream begins.
  let hold: Hold | null = null;

  const openTurn = (t: number): Turn => {
    if (turn && !dialogue && t - lastOutput > TRANSLATE_GAP_MS) { turn.end = 'quiet'; turn = null; }
    if (!turn) {
      turn = { index: turns.length + 1, events: [], text: '', input: pendingInput, audio: [], rate: 24000 };
      pendingInput = '';
      turns.push(turn);
    }
    lastOutput = t;
    return turn;
  };

  ws.on('message', (data, isBinary) => {
    const t = run.now();
    let m;
    try {
      m = decodeServerMessage(isBinary ? new Uint8Array(data as Buffer).buffer.slice(0) : (data as Buffer).toString());
    } catch (e) {
      run.log('in', 'unreadable', { error: (e as Error).message });
      return;
    }
    const raw = m as Record<string, unknown>;
    const sc = m.serverContent;
    const scRaw = sc as Record<string, unknown> | undefined;
    const topKeys = Object.keys(raw);
    run.log('in', 'msg', scRaw ? { top: topKeys, sc: Object.keys(scRaw) } : { top: topKeys });
    for (const k of topKeys) wire.top.set(k, (wire.top.get(k) ?? 0) + 1);
    for (const k of Object.keys(scRaw ?? {})) wire.sc.set(k, (wire.sc.get(k) ?? 0) + 1);
    hold?.message(t);
    if (m.setupComplete) { setupDone = true; run.log('in', 'setupComplete'); }
    if (raw.voiceActivity !== undefined) {
      // Top-level, not in serverContent: {"voiceActivity":{"type":"ACTIVITY_START","audioOffset":"0.360s"}} (the SDK renames `type` to `voiceActivityType`).
      const va = raw.voiceActivity as { type?: string; voiceActivityType?: string; audioOffset?: string } | null;
      const type = va?.type ?? va?.voiceActivityType;
      const offset = /^(-?[\d.]+)s$/.exec(va?.audioOffset ?? '');
      run.log('in', 'voiceActivity', raw.voiceActivity);
      wire.va.push({ t, type, offsetMs: offset ? Number(offset[1]) * 1000 : undefined });
      if (type === 'ACTIVITY_START') wire.vaOpen = true;
      if (type === 'ACTIVITY_END') wire.vaOpen = false;
      hold?.voiceActivity(type);
    }
    if (sc && scRaw) {
      // Which turn an end flag belongs to, taken before the log loop below closes the turn on turnComplete.
      if (sc.generationComplete && turn) turn.gen ??= t;
      if (sc.interrupted && turn) turn.interrupted ??= t;
      const ends = END_ORDER.filter((f) => scRaw[f]);
      for (const flag of ends) wire.ends.push({ t, flag, open: turn !== null });
      for (const part of sc.modelTurn?.parts ?? []) {
        const inline = part.inlineData;
        if (inline?.data && inline.mimeType?.startsWith('audio/')) {
          const pcm = base64ToPcm(inline.data);
          const tr = openTurn(t);
          tr.rate = pcmRate(inline.mimeType);
          tr.audio.push(pcm);
          tr.events.push({ t, kind: 'audio', samples: pcm.length, rate: tr.rate });
          run.log('in', 'audio', { samples: pcm.length, ms: Math.round((1000 * pcm.length) / tr.rate), mime: inline.mimeType });
          hold?.signal('output');
        } else if (part.text) {
          run.log('in', 'modelTurn.text', { text: part.text });
        } else {
          run.log('in', 'modelTurn.part', verbatim(part));
        }
      }
      if (sc.outputTranscription?.text) {
        const tr = openTurn(t);
        tr.text += sc.outputTranscription.text;
        tr.events.push({ t, kind: 'text', chars: sc.outputTranscription.text.length });
        run.log('in', 'outputTranscription', { text: sc.outputTranscription.text, ...(sc.outputTranscription.finished !== undefined ? { finished: sc.outputTranscription.finished } : {}) });
        hold?.signal('output');
      }
      const it = sc.inputTranscription;
      if (it?.text) {
        if (turn) turn.input += it.text; else pendingInput += it.text;
        run.log('in', 'inputTranscription', { text: it.text, ...(it.finished !== undefined ? { finished: it.finished } : {}) });
        if (!wire.grouping) wire.groups.push(0);
        wire.grouping = true;
        wire.groups[wire.groups.length - 1] += 1;
        wire.inputs.push({ t, text: it.text, finished: it.finished, vaOpen: wire.vaOpen });
        hold?.signal('input');
      } else if (it) {
        run.log('in', 'inputTranscription', verbatim(it));
      }
      for (const flag of ['turnComplete', 'generationComplete', 'interrupted', 'waitingForInput'] as const) {
        if ((sc as Record<string, unknown>)[flag]) {
          run.log('in', flag);
          if (flag === 'turnComplete' && turn) { turn.end = 'turnComplete'; turn = null; }
        }
      }
      for (const flag of ends) hold?.end(flag);
      if (ends.length || sc.modelTurn || sc.outputTranscription) wire.grouping = false;
      if (scRaw.interimInputTranscription !== undefined) {
        wire.interim += 1;
        run.log('in', 'interimInputTranscription', verbatim(scRaw.interimInputTranscription));
      }
      for (const k of ['turnCompleteReason', 'interactionStatus']) {
        if (scRaw[k] === undefined) continue;
        run.log('in', k, verbatim(scRaw[k]));
        wire.values.set(k, [...(wire.values.get(k) ?? []), String(scRaw[k])]);
      }
      for (const k of Object.keys(scRaw)) if (!KNOWN_SC.has(k)) run.log('in', `sc.${k}`, verbatim(scRaw[k]));
    }
    if (m.usageMetadata) run.log('in', 'usageMetadata', m.usageMetadata);
    if (m.sessionResumptionUpdate) run.log('in', 'sessionResumptionUpdate', { resumable: m.sessionResumptionUpdate.resumable, handle: m.sessionResumptionUpdate.newHandle ? '<present>' : undefined });
    if (m.goAway) run.log('in', 'goAway', m.goAway);
    for (const k of topKeys) if (!KNOWN_TOP.has(k)) run.log('in', `top.${k}`, verbatim(raw[k]));
  });
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; run.log('ws', 'close', closed); });
  ws.on('error', (e) => run.log('ws', 'error', { message: e.message }));

  const opened = await new Promise<boolean>((resolve) => {
    ws.on('open', () => resolve(true));
    // A refused upgrade: the request is destroyed, or it keeps the process alive.
    ws.on('unexpected-response', (req, res) => { run.log('ws', 'refused', { status: res.statusCode }); res.resume(); req.destroy(); resolve(false); });
    ws.on('error', () => resolve(false));
  });
  run.log('ws', opened ? 'open' : 'not-open');
  if (!opened) { run.report('The socket did not open.'); return; }
  ws.send(JSON.stringify(setup));
  run.log('out', 'setup');
  for (let i = 0; i < 200 && !setupDone && !closed; i++) await sleep(100);
  if (!setupDone) { run.report(`No setupComplete within 20 s; close ${JSON.stringify(closed)}.`); ws.close(); return; }

  const clip = readWav(CLIPS.ja, INPUT_RATE);
  let sent = 0;
  let utterances: Utterance[] = [];
  let streamT0 = 0;
  if (probe.hold) {
    // The capture timeline at real-time pace; every entry through the hold, which sends it or keeps it.
    const o = probe.hold;
    const long = o.clip === 'long';
    const plan = timeline(long ? longClip(clip, INPUT_RATE) : clip, INPUT_RATE, CHUNK_MS, o.gapMs, long ? 20000 : 10000, o.manual, long ? 3 : 1);
    utterances = plan.utterances;
    const t0 = Date.now();
    streamT0 = run.now();
    const h = createHold(o, { run, ws, streamPos: () => Date.now() - t0, where: (pos) => whereIn(plan.utterances, pos), closed: isClosed });
    hold = h;
    run.log('note', 'stream.begin', {
      seconds: plan.endPos / 1000, chunkMs: CHUNK_MS, gapMs: o.gapMs, realtimeInputConfig: ric, hold: o,
      utterances: plan.utterances.map((u) => ({ k: u.k, start: Math.round(u.start), onset: Math.round(u.onset), end: Math.round(u.end), stop: Math.round(u.stop) })),
    });
    for (const e of plan.entries) {
      const wait = t0 + e.pos - Date.now();
      if (wait > 0) await sleep(wait);
      if (isClosed()) break;
      h.push(e);
      sent += 1;
    }
    const rest = t0 + plan.endPos - Date.now();
    if (rest > 0 && !isClosed()) await sleep(rest);
    await h.settle();
  } else {
    const pcm = concat(clip, silence(gapMs, INPUT_RATE), clip, silence(10000, INPUT_RATE));
    run.log('note', 'stream.begin', { seconds: pcm.length / INPUT_RATE, chunkMs: CHUNK_MS, gapMs, realtimeInputConfig: ric });
    if (manual) {
      // Push-to-talk: each utterance between its activity marks; nothing is sent while the key is up.
      for (let k = 0; k < 2 && !closed; k++) {
        ws.send(ACTIVITY_START);
        run.log('out', 'activityStart');
        sent += await pace(clip, INPUT_RATE, CHUNK_MS, (chunk) => ws.send(audioFrame(chunk)), () => closed !== null);
        ws.send(ACTIVITY_END);
        run.log('out', 'activityEnd');
        await sleep(k === 0 ? gapMs : 10000);
      }
    } else {
      sent = await pace(pcm, INPUT_RATE, CHUNK_MS, (chunk) => ws.send(audioFrame(chunk)), () => closed !== null);
    }
  }
  run.log('note', 'stream.done', { chunks: sent });
  for (let i = 0; i < 80 && turn && !closed; i++) await sleep(100);
  if (turn) (turn as Turn).end ??= 'open at the end';
  (hold as Hold | null)?.stop();
  ws.close(1000);
  await sleep(300);

  const all = concat(...turns.flatMap((x) => x.audio));
  if (all.length) writeWav(`${run.dir}/${run.name}.wav`, all, turns[0]?.rate ?? 24000);
  const held = hold as Hold | null;
  run.report([
    `model \`${model}\` (${kind}), ${src} → ${dst}; gap ${gap} ms; activityHandling ${String(ric.activityHandling ?? '(default)')}, turnCoverage ${String(ric.turnCoverage ?? '(default)')}; ${turns.length} turn(s); close ${JSON.stringify(closed)}`,
    `**${coverage(turns)}**`,
    '',
    ...turns.map(analyse),
    wireReport(wire),
    ...(probe.hold && held
      ? [holdReport({ o: probe.hold, utterances, streamT0, holds: held.holds, sent: held.sent, inputs: wire.inputs, turns, ends: wire.ends, va: wire.va })]
      : []),
  ].join('\n\n'));
}

const listed = await check({ apiKey: key }, GEMINI_DEFAULTS, { signal: AbortSignal.timeout(20000) } as never);
if (!listed.ok) {
  console.error(`The model list was refused: ${listed.reason}`);
  process.exit(1);
}
const models = listed.models ?? [];
const ids = models.map((m) => m.id);
console.log(`Live models this key lists: ${ids.join(', ')}`);

/** A comma-separated option, or undefined when absent. */
const list = (name: string) => opt(name)?.split(',').map((s) => s.trim()).filter(Boolean);
function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: readonly T[]): T[] {
  const got = list(name) ?? [...fallback];
  const bad = got.filter((v) => !allowed.includes(v as T));
  if (bad.length) {
    console.error(`--${name}: ${bad.join(', ')} is not one of ${allowed.join(', ')}.`);
    process.exit(2);
  }
  return got as T[];
}
function amount(name: string, fallback: number, min: number): number {
  const v = opt(name);
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isFinite(n) || n < min) {
    console.error(`--${name} must be a number ≥ ${min}.`);
    process.exit(2);
  }
  return n;
}

if (step === 'overlap') {
  const chosen = (opt('models') ?? 'gemini-3.8-live,gemini-2.5-flash-native-audio-preview-12-2025').split(',').filter((m) => ids.includes(m));
  for (const model of chosen) {
    for (const activityHandling of ['NO_INTERRUPTION', 'START_OF_ACTIVITY_INTERRUPTS']) {
      for (const turnCoverage of ['TURN_INCLUDES_ONLY_ACTIVITY', 'TURN_INCLUDES_ALL_INPUT']) {
        await session(isGeminiTranslateModel(model) ? 'translate' : 'dialogue', model, { activityHandling, turnCoverage });
      }
    }
  }
} else if (step === 'hold') {
  const wanted = list('models') ?? ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-12-2025'];
  const chosen = wanted.filter((m) => ids.includes(m));
  const missing = wanted.filter((m) => !ids.includes(m));
  if (missing.length) console.log(`Not listed by this key, skipped: ${missing.join(', ')}`);
  const gaps = (list('gaps') ?? ['300', '600', '900', '1200', '1500']).map(Number);
  if (gaps.some((g) => !Number.isFinite(g) || g < 0)) {
    console.error('--gaps takes comma-separated milliseconds.');
    process.exit(2);
  }
  const policies = oneOf('policy', POLICIES, ['generation']);
  const begins = oneOf('begin', BEGINS, ['activity_end']);
  const releases = oneOf('release', RELEASES, ['burst']);
  // Absent: each model's own rule, as the app sets it (3.x barge-in, 2.5 and Live Translate NO_INTERRUPTION).
  const handlings: Array<string | undefined> = list('activity-handling') ? oneOf('activity-handling', ['NO_INTERRUPTION', 'START_OF_ACTIVITY_INTERRUPTS'], []) : [undefined];
  const turnCoverage = opt('turn-coverage');
  const clipKind = oneOf('clip', ['default', 'long'], ['default'])[0];
  const pacing = amount('pace', 4, 1);
  const minMs = amount('hold-min', 0, 0);
  const maxMs = amount('hold-max', 8000, 1000);
  const short = (v: string) => v.replace(/^(TURN_INCLUDES_|START_OF_ACTIVITY_)/, '').toLowerCase();
  const combos: Array<{ model: string; handling?: string; o: HoldOptions; name: string }> = [];
  for (const model of chosen) {
    for (const handling of handlings) {
      for (const policy of policies) {
        for (const begin of policy === 'none' ? begins.slice(0, 1) : begins) {
          for (const release of policy === 'none' ? releases.slice(0, 1) : releases) {
            for (const gap of gaps) {
              const o: HoldOptions = { policy, begin, release, pace: pacing, minMs, maxMs, manual, gapMs: gap, clip: clipKind };
              const name = [
                'hold', model.replace(/[^a-z0-9.-]+/gi, '_'), `g${gap}`, policy,
                ...(policy === 'none' ? [] : [begin, release === 'paced' ? `paced${pacing}` : release]),
                ...(minMs ? [`min${minMs}`] : []), ...(handling ? [short(handling)] : []), ...(turnCoverage ? [short(turnCoverage)] : []),
                ...(manual ? ['manual'] : []), ...(clipKind === 'long' ? ['long'] : []),
              ].join('-');
              combos.push({ model, handling, o, name });
            }
          }
        }
      }
    }
  }
  // Two utterances, the gap, the tail, and a few seconds of setup and drain per session.
  const clipS = clipKind === 'long' ? 17.2 : 6.16;
  const seconds = combos.reduce((n, c) => n + 2 * clipS + c.o.gapMs / 1000 + (clipKind === 'long' ? 20 : 10) + 3, 0);
  console.log(`hold: ${combos.length} session(s), about ${Math.ceil(seconds / 60)} min`);
  for (const c of combos) {
    await session(isGeminiTranslateModel(c.model) ? 'translate' : 'dialogue', c.model, { activityHandling: c.handling, turnCoverage }, { hold: c.o, name: c.name });
  }
} else {
  const variant: Variant = { activityHandling: opt('activity-handling'), turnCoverage: opt('turn-coverage') };
  for (const kind of kinds as Array<'dialogue' | 'translate'>) {
    // The app's default is Live Translate now (Gemini/AST2 follow-up, ruling 3): the dialogue run takes the default among the dialogue models.
    const model = opt('model') ?? (kind === 'dialogue' ? defaultGeminiModel(models.filter((m) => !isGeminiTranslateModel(m.id))) : ids.find((id) => isGeminiTranslateModel(id)));
    if (!model) { console.log(`No ${kind} model listed; skipped.`); continue; }
    await session(kind, model, variant);
  }
}
console.log('done');
