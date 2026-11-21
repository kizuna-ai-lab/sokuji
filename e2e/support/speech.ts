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

/** A 16-bit mono WAV's samples as base64, and its sample rate. */
export function clip(name: string): Clip {
  const wav = fs.readFileSync(path.join(REPO, 'scripts/dev/wire-probe/assets/ja', `${name}.wav`));
  const rate = wav.readUInt32LE(24);
  let at = 12;
  while (wav.toString('latin1', at, at + 4) !== 'data') at += 8 + wav.readUInt32LE(at + 4);
  return { pcm: wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4)).toString('base64'), rate };
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
