import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { REPO } from './app';
import type { StoredRecord } from './history';

/**
 * The repository's eight Japanese sentences (scripts/dev/wire-probe/assets/ja): a word each must be heard, and a word
 * its English must carry. (`door.wav` ends with a stray sound that Soniox hears as a short sentence of its own; the
 * counts below take the expected words and do not mind it.)
 */
export const SENTENCES = [
  { file: 'umbrella', heard: /傘/, said: /umbrella/i }, // 今日は雨が降りそうなので、傘を持っていきます。
  { file: 'door', heard: /ドア|扉/, said: /\bdoor/i }, // ドアを閉めてください。
  { file: 'meeting', heard: /会議/, said: /meeting/i }, // 明日の会議は午後三時に始まります。
  { file: 'book', heard: /本/, said: /\bbook/i }, // この本はとても面白かったです。
  { file: 'dinner', heard: /夕食|夕飯|晩ご飯/, said: /dinner|supper/i }, // 週末に家族と一緒に夕食を食べました。
  { file: 'cafe', heard: /カフェ/, said: /caf[eé]|coffee/i }, // 駅の近くに新しいカフェができました。
  { file: 'train', heard: /電車/, said: /\btrain/i }, // 電車が十分遅れています。
  { file: 'wait', heard: /待/, said: /\bwait|moment/i }, // 少々お待ちください。
];
/** The pause after each sentence, as a person leaves them: some short, some long. */
export const PAUSES_MS = [2400, 400, 2200, 1800, 1400, 2000, 900, 3000];

export interface Clip { pcm: string; rate: number }

/**
 * A 16-bit mono PCM WAV's samples as base64, and its sample rate. Any other file is refused by name: its samples
 * would be played at the wrong speed, or as noise.
 */
export function clip(name: string): Clip {
  const file = path.join(REPO, 'scripts/dev/wire-probe/assets/ja', `${name}.wav`);
  return pcm16Mono(fs.readFileSync(file), file);
}

/** The samples and the sample rate of a 16-bit mono PCM WAV; `file` names it in what is thrown. */
function pcm16Mono(wav: Buffer, file: string): Clip {
  const refuse = (why: string): never => { throw new Error(`${file}: ${why}`); };
  const tag = (at: number) => wav.toString('latin1', at, at + 4);
  if (wav.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') refuse('not a WAV file');
  let rate: number | null = null;
  // Each chunk: a four-letter name, its size, its bytes, and a pad byte after an odd size.
  for (let at = 12; at + 8 <= wav.length;) {
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (tag(at) === 'fmt ') {
      if (size < 16 || body + 16 > wav.length) refuse('its fmt chunk is cut short');
      const [format, channels, bits] = [wav.readUInt16LE(body), wav.readUInt16LE(body + 2), wav.readUInt16LE(body + 14)];
      if (format !== 1 || channels !== 1 || bits !== 16) {
        refuse(`not 16-bit mono PCM (format ${format}, ${channels} channel(s), ${bits} bits)`);
      }
      rate = wav.readUInt32LE(body + 4);
    } else if (tag(at) === 'data') {
      if (rate === null) return refuse('its data chunk comes before any fmt chunk');
      if (body + size > wav.length) refuse('its data chunk is cut short');
      return { pcm: wav.subarray(body, body + size).toString('base64'), rate };
    }
    at = body + size + (size % 2);
  }
  return refuse('no data chunk');
}

/** Plays a clip into the app's microphone (seed `'e2e.mic': 'speech'`); resolves when it has been said. */
export const say = (page: Page, { pcm, rate }: Clip) => page.evaluate(
  ({ pcm, rate }) => (navigator.mediaDevices as MediaDevices & { __e2eSay(pcm: string, rate: number): Promise<void> }).__e2eSay(pcm, rate),
  { pcm, rate },
);

/**
 * How many of the sentences said (by index into `SENTENCES`, one entry each time one was said) the record holds as
 * heard, and how many as translated: each sentence's word counted in the record's text, never more often than it
 * was said.
 */
export function heardAndTranslated(record: StoredRecord, spoken: readonly number[]): { heard: number; translated: number } {
  const text = (side: 'source' | 'translation') => record.segments.filter((segment) => segment.side === side).map((segment) => segment.text).join('\n');
  const count = (source: string, word: RegExp) => source.match(new RegExp(word.source, `${word.flags.replace('g', '')}g`))?.length ?? 0;
  let heard = 0;
  let translated = 0;
  SENTENCES.forEach((sentence, i) => {
    const times = spoken.filter((said) => said === i).length;
    heard += Math.min(times, count(text('source'), sentence.heard));
    translated += Math.min(times, count(text('translation'), sentence.said));
  });
  return { heard, translated };
}
