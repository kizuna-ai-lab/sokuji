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
 *   GEMINI_API_KEY=… npx tsx scripts/dev/wire-probe/gemini.mts [dialogue|translate|both] [--model <id>] [--src ja-JP --dst en-US]
 */
import WebSocket from 'ws';
import { checkGemini } from '../../../src/providers/gemini/check';
import type { GeminiConfig } from '../../../src/providers/gemini/config';
import {
  GEMINI_DEFAULT_VOICE, GEMINI_DEFAULTS, defaultGeminiModel, geminiLanguageName, isGeminiTranslateModel, toTranslationLanguageCode,
} from '../../../src/providers/gemini/settings';
import { audioFrame, base64ToPcm, decodeServerMessage, liveUrl, pcmRate, setupFrame } from '../../../src/providers/gemini/wire';
import { resolveInstructions } from '../../../src/lib/provider/instructions';
import { CLIPS, args, concat, pace, readWav, secret, silence, sleep, startRun, writeWav, type Run } from './common.mts';

const INPUT_RATE = 24000;
const CHUNK_MS = 100;
/** A Live Translate "turn" (it has none): output separated from the next by this much quiet. */
const TRANSLATE_GAP_MS = 2000;

const key = secret(process.env.GEMINI_API_KEY);
if (!key) {
  console.error('Set GEMINI_API_KEY.');
  process.exit(2);
}
const { step, opt } = args();
const kinds = step === 'dialogue' || step === 'translate' ? [step] : ['dialogue', 'translate'];
const src = opt('src') ?? 'ja-JP';
const dst = opt('dst') ?? 'en-US';

interface Arrival { t: number; kind: 'audio' | 'text'; samples?: number; rate?: number; chars?: number }
interface Turn { index: number; events: Arrival[]; text: string; input: string; audio: Int16Array[]; rate: number; end?: string }

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
  if (total === 0 || L === 0) return lines.join('\n');

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
  return lines.join('\n');
}

async function session(kind: 'dialogue' | 'translate', model: string): Promise<void> {
  const run: Run = startRun('gemini', `${kind}-${model.replace(/[^a-z0-9.-]+/gi, '_')}`);
  const dialogue = kind === 'dialogue';
  const config: GeminiConfig = {
    model,
    kind,
    instructions: resolveInstructions(GEMINI_DEFAULTS, { participant: false, source: geminiLanguageName(src), target: geminiLanguageName(dst) }),
    ...(dialogue ? { voice: GEMINI_DEFAULT_VOICE, temperature: GEMINI_DEFAULTS.temperature } : { translationTargetCode: toTranslationLanguageCode(dst) }),
    activity: { manual: false, start: GEMINI_DEFAULTS.vadStartSensitivity, end: GEMINI_DEFAULTS.vadEndSensitivity, silenceMs: GEMINI_DEFAULTS.vadSilenceDurationMs, prefixMs: GEMINI_DEFAULTS.vadPrefixPaddingMs },
  };
  const setup = setupFrame(config, null);
  run.log('note', 'config', { kind, model, src, dst, setup: { ...setup, setup: { ...setup.setup, systemInstruction: setup.setup.systemInstruction ? '<the app template>' : undefined } } });

  const ws = new WebSocket(liveUrl(key));
  let closed: { code: number; reason: string } | null = null;
  const turns: Turn[] = [];
  let turn: Turn | null = null;
  let lastOutput = 0;
  let setupDone = false;
  let pendingInput = '';

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
    if (m.setupComplete) { setupDone = true; run.log('in', 'setupComplete'); }
    const sc = m.serverContent;
    if (sc) {
      for (const part of sc.modelTurn?.parts ?? []) {
        const inline = part.inlineData;
        if (inline?.data && inline.mimeType?.startsWith('audio/')) {
          const pcm = base64ToPcm(inline.data);
          const tr = openTurn(t);
          tr.rate = pcmRate(inline.mimeType);
          tr.audio.push(pcm);
          tr.events.push({ t, kind: 'audio', samples: pcm.length, rate: tr.rate });
          run.log('in', 'audio', { samples: pcm.length, ms: Math.round((1000 * pcm.length) / tr.rate), mime: inline.mimeType });
        } else if (part.text) {
          run.log('in', 'modelTurn.text', { text: part.text });
        }
      }
      if (sc.outputTranscription?.text) {
        const tr = openTurn(t);
        tr.text += sc.outputTranscription.text;
        tr.events.push({ t, kind: 'text', chars: sc.outputTranscription.text.length });
        run.log('in', 'outputTranscription', { text: sc.outputTranscription.text });
      }
      if (sc.inputTranscription?.text) {
        if (turn) turn.input += sc.inputTranscription.text; else pendingInput += sc.inputTranscription.text;
        run.log('in', 'inputTranscription', { text: sc.inputTranscription.text });
      }
      for (const flag of ['turnComplete', 'generationComplete', 'interrupted', 'waitingForInput'] as const) {
        if ((sc as Record<string, unknown>)[flag]) {
          run.log('in', flag);
          if (flag === 'turnComplete' && turn) { turn.end = 'turnComplete'; turn = null; }
        }
      }
    }
    if (m.usageMetadata) run.log('in', 'usageMetadata', m.usageMetadata);
    if (m.sessionResumptionUpdate) run.log('in', 'sessionResumptionUpdate', { resumable: m.sessionResumptionUpdate.resumable, handle: m.sessionResumptionUpdate.newHandle ? '<present>' : undefined });
    if (m.goAway) run.log('in', 'goAway', m.goAway);
  });
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; run.log('ws', 'close', closed); });
  ws.on('error', (e) => run.log('ws', 'error', { message: e.message }));

  const opened = await new Promise<boolean>((resolve) => {
    ws.on('open', () => resolve(true));
    ws.on('unexpected-response', (_req, res) => { run.log('ws', 'refused', { status: res.statusCode }); resolve(false); });
    ws.on('error', () => resolve(false));
  });
  run.log('ws', opened ? 'open' : 'not-open');
  if (!opened) { run.report('The socket did not open.'); return; }
  ws.send(JSON.stringify(setup));
  run.log('out', 'setup');
  for (let i = 0; i < 200 && !setupDone && !closed; i++) await sleep(100);
  if (!setupDone) { run.report(`No setupComplete within 20 s; close ${JSON.stringify(closed)}.`); ws.close(); return; }

  const clip = readWav(CLIPS.ja, INPUT_RATE);
  const pcm = concat(clip, silence(2500, INPUT_RATE), clip, silence(10000, INPUT_RATE));
  run.log('note', 'stream.begin', { seconds: pcm.length / INPUT_RATE, chunkMs: CHUNK_MS });
  const sent = await pace(pcm, INPUT_RATE, CHUNK_MS, (chunk) => ws.send(audioFrame(chunk)), () => closed !== null);
  run.log('note', 'stream.done', { chunks: sent });
  for (let i = 0; i < 80 && turn && !closed; i++) await sleep(100);
  if (turn) (turn as Turn).end ??= 'open at the end';
  ws.close(1000);
  await sleep(300);

  const all = concat(...turns.flatMap((x) => x.audio));
  if (all.length) writeWav(`${run.dir}/${run.name}.wav`, all, turns[0]?.rate ?? 24000);
  run.report([
    `model \`${model}\` (${kind}), ${src} → ${dst}; ${turns.length} turn(s); close ${JSON.stringify(closed)}`,
    '',
    ...turns.map(analyse),
  ].join('\n\n'));
}

const listed = await checkGemini({ apiKey: key }, GEMINI_DEFAULTS, { signal: AbortSignal.timeout(20000) } as never);
if (!listed.ok) {
  console.error(`The model list was refused: ${listed.reason}`);
  process.exit(1);
}
const ids = listed.models.map((m) => m.id);
console.log(`Live models this key lists: ${ids.join(', ')}`);
for (const kind of kinds as Array<'dialogue' | 'translate'>) {
  const model = opt('model') ?? (kind === 'dialogue' ? defaultGeminiModel(listed.models) : ids.find((id) => isGeminiTranslateModel(id)));
  if (!model) { console.log(`No ${kind} model listed; skipped.`); continue; }
  await session(kind, model);
}
console.log('done');
