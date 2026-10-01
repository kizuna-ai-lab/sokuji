/**
 * The recorded sessions the translation-cuts tests replay, written as small
 * fixtures: the OpenAI Translate spike's three (`openai-translate.mts
 * record`) and one Gemini Live Translate session (`gemini.mts`). Each keeps
 * what a leg's segments see, in the order and at the time it arrived — each
 * transcript delta's text, and each audio frame's length and, where the probe
 * measured it, its RMS. No pcm, no `elapsed_ms`, no key: the recordings hold
 * none of the last, and the rest is not read. An all-zero frame (a heartbeat)
 * is left out, since the adapter drops it before its segments.
 *
 *   npx tsx scripts/dev/wire-probe/translation-cuts-fixtures.mts
 *
 * Reads the probes' `.jsonl` recordings under `.superpowers/wire-probes/`
 * (git-ignored) and writes `src/lib/segmentation/recordings/<name>.json`.
 * No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './common.mts';

const PROBES = path.join(REPO, '.superpowers/wire-probes');
const TO = path.join(REPO, 'src/lib/segmentation/recordings');

type Line = { t: number; dir: string; type: string; d?: Record<string, unknown> };
type Reader = (l: Line) => unknown[] | null;

/** OpenAI Translate's spike: each frame's arrival `t`, its delta, or its frame's length, RMS and whether it was all zero. */
const openaiTranslate: Reader = (l) => {
  const d = l.d ?? {};
  const t = typeof d.t === 'number' ? d.t : l.t;
  if (l.type === 'session.input_transcript.delta' && typeof d.delta === 'string' && d.delta) return [t, 's', d.delta];
  if (l.type === 'session.output_transcript.delta' && typeof d.delta === 'string' && d.delta) return [t, 't', d.delta];
  if (l.type === 'session.output_audio.delta' && typeof d.len === 'number' && d.len > 0 && d.zero !== true) return [t, 'a', d.len, typeof d.rms === 'number' ? d.rms : 0];
  return null;
};

/** Gemini's probe: each message's arrival `t`, a transcription's text, or an audio part's length — it measured no RMS. */
const geminiLiveTranslate: Reader = (l) => {
  const d = l.d ?? {};
  if (l.type === 'inputTranscription' && typeof d.text === 'string' && d.text) return [l.t, 's', d.text];
  if (l.type === 'outputTranscription' && typeof d.text === 'string' && d.text) return [l.t, 't', d.text];
  if (l.type === 'audio' && typeof d.samples === 'number' && d.samples > 0) return [l.t, 'a', d.samples];
  return null;
};

const FIXTURES: Array<[name: string, run: string, read: Reader]> = [
  ['user', 'openai-translate/2026-09-29T17-19-57-user', openaiTranslate],
  ['tight', 'openai-translate/2026-09-29T17-21-44-tight', openaiTranslate],
  ['long', 'openai-translate/2026-09-29T17-24-18-long', openaiTranslate],
  // Push-to-talk: the clip went up in two presses 2.5 s apart, so its source splits where the first press ended.
  ['gemini-live-translate', 'gemini/2026-09-28T19-41-14-translate-gemini-3.5-live-translate-preview', geminiLiveTranslate],
];

fs.mkdirSync(TO, { recursive: true });
for (const [name, run, read] of FIXTURES) {
  const lines = fs.readFileSync(path.join(PROBES, `${run}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Line);
  const events = lines.filter((l) => l.dir === 'in').map(read).filter((e) => e !== null).map((e) => JSON.stringify(e));
  const file = path.join(TO, `${name}.json`);
  fs.writeFileSync(file, `{\n  "run": ${JSON.stringify(path.basename(run))},\n  "events": [\n    ${events.join(',\n    ')}\n  ]\n}\n`);
  console.log(`${path.relative(REPO, file)}: ${events.length} events`);
}
