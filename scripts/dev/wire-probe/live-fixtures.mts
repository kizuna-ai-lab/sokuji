/**
 * The recorded OpenAI Live sessions the port's tests replay (`live.mts`,
 * run by the owner on 2026-09-30), written as small fixtures. Each keeps
 * what a leg's segments see, in the order and at the time it arrived: each
 * transcript delta's text with its `start_ms` / `end_ms`, and every output
 * audio frame's length and RMS — the noise floor's frames too, since they
 * count on the output's sample clock the karaoke reads. The `timeline`
 * session also keeps whisper-1's word times for its voiced output, placed on
 * that sample clock as the probe placed them (U4). No pcm, no key: the
 * recordings hold neither, and the rest is not read.
 *
 *   npx tsx scripts/dev/wire-probe/live-fixtures.mts
 *
 * Reads `live.mts`' `.jsonl` recordings under
 * `.superpowers/wire-probes/openai-live/` (git-ignored) and writes
 * `src/providers/openai_live/recordings/<name>.json`. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './common.mts';

const PROBES = path.join(REPO, '.superpowers/wire-probes/openai-live');
const TO = path.join(REPO, 'src/providers/openai_live/recordings');
/** `live.mts`' floor: a frame at or below it is the stream's dithered silence. */
const FLOOR_RMS = 0.002;
const RATE = 24_000;

type Line = { t: number; dir: string; type: string; d?: Record<string, unknown> };
const stamp = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `[arrival, 's' | 't', delta, start_ms, end_ms]`, or `[arrival, 'a', samples, rms]`. */
function read(l: Line): unknown[] | null {
  const d = l.d ?? {};
  if (l.type === 'session.input_transcript.delta' && typeof d.delta === 'string' && d.delta) return [l.t, 's', d.delta, stamp(d.start_ms), stamp(d.end_ms)];
  if (l.type === 'session.output_transcript.delta' && typeof d.delta === 'string' && d.delta) return [l.t, 't', d.delta, stamp(d.start_ms), stamp(d.end_ms)];
  if (l.type === 'session.output_audio.delta' && typeof d.samples === 'number' && d.samples > 0) return [l.t, 'a', d.samples, typeof d.rms === 'number' ? d.rms : 0];
  return null;
}

/** whisper-1's words on the played (voiced-only) stream, placed on the full stream's sample clock in ms, as `live.mts`' `karaoke()` placed them. */
function placeWords(lines: Line[], file: string): Array<[number, number, string]> {
  const words = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ word: string; start: number; end: number }>;
  const played: Array<{ off: number; samples: number; at: number }> = [];
  let off = 0;
  let at = 0;
  for (const l of lines) {
    if (l.dir !== 'in' || l.type !== 'session.output_audio.delta') continue;
    const samples = Number(l.d?.samples ?? 0);
    if (Number(l.d?.rms ?? 0) > FLOOR_RMS) { played.push({ off, samples, at }); at += samples; }
    off += samples;
  }
  const locate = (secs: number, edge: 'start' | 'end'): number | null => {
    const smp = secs * RATE - (edge === 'end' ? 1 : 0);
    const p = played.find((x) => smp >= x.at && smp < x.at + x.samples);
    return p ? Math.round((p.off + (smp - p.at) + (edge === 'end' ? 1 : 0)) / (RATE / 1000)) : null;
  };
  return words.flatMap((w) => {
    const s = locate(w.start, 'start');
    const e = locate(Math.max(w.start, w.end), 'end');
    return s !== null && e !== null ? [[s, e, w.word] as [number, number, string]] : [];
  });
}

const FIXTURES: Array<[name: string, run: string, words?: string]> = [
  // U4, U5: 1 s with no appends, the owner's six sentences with his pauses, 15 s of silence.
  ['timeline', '2026-09-29T18-32-45-timeline-client', '2026-09-29T18-32-45-timeline-client.words.json'],
  // U1: the same clip, then 20 s with no appends, then 10 s of paced silence.
  ['release', '2026-09-29T18-32-45-release'],
  // U2': three sentences, mute and nothing appended for 20 s, unmute, one sentence, 10 s of silence — the push-to-talk release (ruling 5).
  ['mute', '2026-09-29T18-41-24-mute-noappend'],
];

fs.mkdirSync(TO, { recursive: true });
for (const [name, run, words] of FIXTURES) {
  const lines = fs.readFileSync(path.join(PROBES, `${run}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Line);
  const events = lines.filter((l) => l.dir === 'in').map(read).filter((e) => e !== null).map((e) => JSON.stringify(e));
  const placed = words ? placeWords(lines, path.join(PROBES, words)).map((w) => JSON.stringify(w)) : null;
  const file = path.join(TO, `${name}.json`);
  const wordsPart = placed ? `,\n  "words": [\n    ${placed.join(',\n    ')}\n  ]` : '';
  fs.writeFileSync(file, `{\n  "run": ${JSON.stringify(run)},\n  "events": [\n    ${events.join(',\n    ')}\n  ]${wordsPart}\n}\n`);
  console.log(`${path.relative(REPO, file)}: ${events.length} events${placed ? `, ${placed.length} words` : ''}`);
}
