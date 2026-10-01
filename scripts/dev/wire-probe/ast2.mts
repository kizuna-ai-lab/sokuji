/**
 * Doubao AST 2.0, dialled with the app's own wire (`src/providers/volcengine_ast2/wire.ts`):
 * one speech-to-speech session per language pair, each fed a recorded clip
 * twice at real-time pace in the adapter's 80 ms 16 kHz packets. It records
 * every subtitle and TTS event with its fields and arrival time, saves each
 * spoken sentence as an `.ogg`, and answers the karaoke question: does a TTS
 * sentence carry its text, and does each TTS sentence line up with one
 * translation subtitle — the segment the adapter locks it to at
 * `TTSSentenceStart`.
 *
 *   AST2_API_KEY=… npx tsx scripts/dev/wire-probe/ast2.mts [--pairs ja-zh,zh-en]
 *   AST2_APP=… AST2_TOKEN=… npx tsx scripts/dev/wire-probe/ast2.mts
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import WebSocket from 'ws';
import { ast2Offers, type Ast2Credentials } from '../../../src/providers/volcengine_ast2/settings';
import {
  EventType, ast2Url, audioFrame, decodeResponse, eventName, finishSessionFrame, isOk, startSessionFrame, toNumber, type Ast2Response,
} from '../../../src/providers/volcengine_ast2/wire';
import { CLIPS, args, concat, pace, readWav, secret, silence, sleep, startRun, type Run } from './common.mts';

const INPUT_RATE = 16_000;
const PACKET_MS = 80;

const apiKey = secret(process.env.AST2_API_KEY);
const appKey = secret(process.env.AST2_APP);
const accessKey = secret(process.env.AST2_TOKEN);
const credentials: Ast2Credentials | null = apiKey
  ? { kind: 'apiKey', apiKey }
  : appKey && accessKey ? { kind: 'app', appKey, accessKey } : null;
if (!credentials) {
  console.error('Set AST2_API_KEY, or AST2_APP and AST2_TOKEN.');
  process.exit(2);
}
const { opt } = args();
const pairs = (opt('pairs') ?? 'ja-zh,zh-en').split(',').map((p) => {
  const [source, target] = p.split('-');
  return { source, target };
});

/** An Ogg Opus stream's duration: the last page's granule position, less the pre-skip, at 48 kHz. */
function oggSeconds(ogg: Uint8Array): number | null {
  const b = Buffer.from(ogg.buffer, ogg.byteOffset, ogg.byteLength);
  let off = 0;
  let granule = -1n;
  let preSkip = 0;
  while (off + 27 <= b.length && b.toString('ascii', off, off + 4) === 'OggS') {
    const segments = b[off + 26];
    let body = 0;
    for (let i = 0; i < segments; i++) body += b[off + 27 + i];
    const start = off + 27 + segments;
    if (b.toString('ascii', start, start + 8) === 'OpusHead') preSkip = b.readUInt16LE(start + 10);
    const g = b.readBigInt64LE(off + 6);
    if (g >= 0n) granule = g;
    off = start + body;
  }
  return granule < 0n ? null : Math.max(0, Number(granule) - preSkip) / 48000;
}

interface Subtitle { index: number; startAt: number; endAt?: number; text: string; startTime?: number; endTime?: number }
interface TtsSentence {
  index: number;
  startAt: number;
  endAt?: number;
  chunks: Uint8Array[];
  texts: string[];
  times: Array<[number | undefined, number | undefined]>;
  /** The translation subtitle current (else the last one) when the sentence began: the adapter's lock. */
  locked?: number;
}

function words(a: string): string { return a.replace(/[\s\p{P}]/gu, ''); }

function relation(tts: string, subtitle: string): string {
  const t = words(tts);
  const s = words(subtitle);
  if (!t || !s) return 'no text to compare';
  if (t === s) return 'equal';
  if (s.includes(t)) return 'a part of the subtitle';
  if (t.includes(s)) return 'contains the whole subtitle, and more';
  return 'differs';
}

async function session(source: string, target: string): Promise<void> {
  const run: Run = startRun('ast2', `s2s-${source}-${target}`);
  if (!ast2Offers({ source, target }, { speech: true })) {
    run.report(`Doubao does not speak ${source} → ${target} (the app's own offer); skipped.`);
    return;
  }
  const clipFile = source === 'zh' ? CLIPS.zh : CLIPS.ja;
  const ids = { session: randomUUID(), connection: randomUUID() };
  let sequence = 0;
  const subtitles: Record<'source' | 'translation', Subtitle[]> = { source: [], translation: [] };
  const current: Record<'source' | 'translation', Subtitle | null> = { source: null, translation: null };
  const tts: TtsSentence[] = [];
  let sentence: TtsSentence | null = null;
  let started = false;
  let finished = false;
  let closed: { code: number; reason: string } | null = null;

  const ws = new WebSocket(ast2Url(credentials!));
  ws.binaryType = 'arraybuffer';

  const onSubtitle = (side: 'source' | 'translation', phase: 'start' | 'response' | 'end', r: Ast2Response, t: number) => {
    run.log('in', `subtitle.${side}.${phase}`, { text: r.text, startTime: r.startTime, endTime: r.endTime, spkChg: r.spkChg || undefined });
    if (phase === 'start' || !current[side]) {
      current[side] = { index: subtitles[side].length + 1, startAt: t, text: '' };
      subtitles[side].push(current[side]!);
    }
    const s = current[side]!;
    if (r.text) s.text = r.text;
    if (r.startTime) s.startTime = r.startTime;
    if (r.endTime) s.endTime = r.endTime;
    if (phase === 'end') { s.endAt = t; current[side] = null; }
  };

  ws.on('message', (data) => {
    const t = run.now();
    let r: Ast2Response;
    try {
      r = decodeResponse(data as ArrayBuffer);
    } catch (e) {
      run.log('in', 'unreadable', { error: (e as Error).message });
      return;
    }
    const meta = r.responseMeta;
    const status = meta?.StatusCode ?? 0;
    if (!isOk(status)) run.log('in', 'status', { event: eventName(r.event), status, message: meta?.Message });
    switch (r.event) {
      case EventType.SessionStarted: started = true; run.log('in', 'SessionStarted'); return;
      case EventType.SessionFailed: run.log('in', 'SessionFailed', { status, message: meta?.Message }); finished = true; return;
      case EventType.SessionFinished: case EventType.SessionCanceled: run.log('in', eventName(r.event)); finished = true; return;
      case EventType.SourceSubtitleStart: onSubtitle('source', 'start', r, t); return;
      case EventType.SourceSubtitleResponse: onSubtitle('source', 'response', r, t); return;
      case EventType.SourceSubtitleEnd: onSubtitle('source', 'end', r, t); return;
      case EventType.TranslationSubtitleStart: onSubtitle('translation', 'start', r, t); return;
      case EventType.TranslationSubtitleResponse: onSubtitle('translation', 'response', r, t); return;
      case EventType.TranslationSubtitleEnd: onSubtitle('translation', 'end', r, t); return;
      case EventType.TTSSentenceStart: {
        const locked = current.translation?.index ?? subtitles.translation.at(-1)?.index;
        sentence = { index: tts.length + 1, startAt: t, chunks: [], texts: [], times: [], locked };
        tts.push(sentence);
        if (r.text) sentence.texts.push(r.text);
        sentence.times.push([r.startTime ?? undefined, r.endTime ?? undefined]);
        run.log('in', 'TTSSentenceStart', { text: r.text, startTime: r.startTime, endTime: r.endTime, lockedTo: locked ?? null, dataBytes: r.data?.length ?? 0 });
        return;
      }
      case EventType.TTSResponse: {
        const s = sentence ?? (() => { const n: TtsSentence = { index: tts.length + 1, startAt: t, chunks: [], texts: [], times: [] }; tts.push(n); return n; })();
        sentence = s;
        if (r.data?.length) s.chunks.push(r.data.slice());
        if (r.text) s.texts.push(r.text);
        run.log('in', 'TTSResponse', { bytes: r.data?.length ?? 0, ...(r.text ? { text: r.text } : {}), ...(r.startTime ? { startTime: r.startTime, endTime: r.endTime } : {}) });
        return;
      }
      case EventType.TTSSentenceEnd: case EventType.TTSEnded: {
        if (sentence) {
          sentence.endAt = t;
          if (r.text) sentence.texts.push(r.text);
          sentence.times.push([r.startTime ?? undefined, r.endTime ?? undefined]);
        }
        run.log('in', eventName(r.event), { text: r.text, startTime: r.startTime, endTime: r.endTime, dataBytes: r.data?.length ?? 0 });
        if (r.event === EventType.TTSSentenceEnd) sentence = null;
        return;
      }
      case EventType.UsageResponse: {
        const billing = meta?.Billing;
        run.log('in', 'UsageResponse', { durationMsec: toNumber(billing?.DurationMsec) ?? null, wordCount: toNumber(billing?.WordCount) ?? null });
        return;
      }
      default:
        run.log('in', eventName(r.event), { text: r.text || undefined, startTime: r.startTime || undefined, endTime: r.endTime || undefined, mutedDurationMs: r.mutedDurationMs || undefined, dataBytes: r.data?.length || undefined });
    }
  });
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; run.log('ws', 'close', closed); });
  ws.on('error', (e) => run.log('ws', 'error', { message: e.message }));

  const opened = await new Promise<boolean>((resolve) => {
    ws.on('open', () => resolve(true));
    // A refused upgrade: the request is destroyed, or it keeps the process alive.
    ws.on('unexpected-response', (req, res) => { run.log('ws', 'refused', { status: res.statusCode }); res.resume(); req.destroy(); resolve(false); });
    ws.on('error', () => resolve(false));
  });
  run.log('ws', opened ? 'open' : 'not-open', { credentials: credentials!.kind });
  if (!opened) { run.report('The socket did not open (a refused credential is an HTTP 401 on the upgrade).'); return; }

  ws.send(startSessionFrame({ ids, sequence: sequence++, mode: 's2s', source, target, ...(credentials!.kind === 'app' ? { appKey: credentials!.appKey } : {}) }));
  run.log('out', 'StartSession', { mode: 's2s', source, target });
  for (let i = 0; i < 150 && !started && !finished && !closed; i++) await sleep(100);
  if (!started) { run.report(`No SessionStarted within 15 s; close ${JSON.stringify(closed)}.`); ws.close(); return; }

  const clip = readWav(clipFile, INPUT_RATE);
  const pcm = concat(clip, silence(2500, INPUT_RATE), clip, silence(8000, INPUT_RATE));
  run.log('note', 'stream.begin', { seconds: pcm.length / INPUT_RATE, packetMs: PACKET_MS });
  const sent = await pace(pcm, INPUT_RATE, PACKET_MS, (chunk) => {
    const packet = new Int16Array(INPUT_RATE * PACKET_MS / 1000);
    packet.set(chunk);
    ws.send(audioFrame(ids, sequence++, packet));
  }, () => closed !== null || finished);
  run.log('note', 'stream.done', { packets: sent });
  if (!closed) { ws.send(finishSessionFrame(ids, sequence++)); run.log('out', 'FinishSession'); }
  for (let i = 0; i < 150 && !finished && !closed; i++) await sleep(100);
  ws.close(1000);
  await sleep(300);

  // Each spoken sentence as its own playable file.
  tts.forEach((s) => {
    const ogg = concat8(s.chunks);
    if (ogg.length) fs.writeFileSync(`${run.dir}/${run.name}-tts${s.index}.ogg`, ogg);
  });

  const lines: string[] = [];
  lines.push(`${source} → ${target}, credentials: ${credentials!.kind}; close ${JSON.stringify(closed)}; source subtitles ${subtitles.source.length}, translation subtitles ${subtitles.translation.length}, TTS sentences ${tts.length}`);
  lines.push('');
  lines.push('**Translation subtitles**');
  lines.push('');
  for (const s of subtitles.translation) lines.push(`- T${s.index} @${(s.startAt / 1000).toFixed(2)}–${s.endAt ? (s.endAt / 1000).toFixed(2) : '?'} s (server ${s.startTime ?? '-'}–${s.endTime ?? '-'} ms): “${s.text}”`);
  lines.push('');
  lines.push('**TTS sentences** (arrival; audio length; the text the TTS events carried, if any; the subtitle the adapter locks it to)');
  lines.push('');
  for (const s of tts) {
    const seconds = oggSeconds(concat8(s.chunks));
    const text = [...new Set(s.texts)].join(' | ');
    const lockedText = subtitles.translation.find((x) => x.index === s.locked)?.text ?? '';
    const times = s.times.filter(([a, b]) => a || b).map(([a, b]) => `${a ?? '-'}–${b ?? '-'} ms`).join(', ');
    lines.push(`- S${s.index} @${(s.startAt / 1000).toFixed(2)}–${s.endAt ? (s.endAt / 1000).toFixed(2) : '?'} s; ${seconds === null ? '?' : seconds.toFixed(2)} s of audio in ${s.chunks.length} chunks; TTS text: ${text ? `“${text}”` : 'none'}${times ? `; server times ${times}` : ''}; locked to T${s.locked ?? '-'}${text && lockedText ? ` (${relation(text, lockedText)})` : ''}`);
  }
  const lockCounts = new Map<number | undefined, number>();
  for (const s of tts) lockCounts.set(s.locked, (lockCounts.get(s.locked) ?? 0) + 1);
  const unspoken = subtitles.translation.filter((x) => !lockCounts.has(x.index)).map((x) => `T${x.index}`);
  const shared = [...lockCounts].filter(([, n]) => n > 1).map(([i, n]) => `T${i ?? '-'}×${n}`);
  lines.push('');
  lines.push(`- one TTS sentence per translation subtitle: ${tts.length === subtitles.translation.length && shared.length === 0 && unspoken.length === 0 ? 'yes' : 'no'}${shared.length ? `; subtitles with more than one TTS sentence: ${shared.join(' ')}` : ''}${unspoken.length ? `; subtitles no TTS sentence locked to: ${unspoken.join(' ')}` : ''}`);
  run.report(lines.join('\n'));
}

function concat8(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

for (const { source, target } of pairs) await session(source, target);
console.log('done');
