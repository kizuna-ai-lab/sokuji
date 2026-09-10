#!/usr/bin/env node
// Regenerate src/lib/soniox/sonioxVoiceRoster.ts from Soniox's live roster.
//
// The roster is a SNAPSHOT because it cannot be fetched at runtime by every
// account that needs it: `GET /v1/shared-voices` accepts only a PERMANENT
// project key (a `tts_rt` temporary key is answered 401, verified 2026-09-10),
// and managed Kizuna AI users never hold one. Fetching live for BYOK and
// shipping a snapshot for managed would give the two paths different voice
// lists — so both read this file, and this script is how it moves.
//
// It moves often: 71 voices at v2 GA (2026-08-11), 70 hours later, 200 on
// 2026-09-10. Re-run this whenever Soniox announces voices; the diff is the
// review.
//
//   SONIOX_API_KEY=snx_proj_... node scripts/fetch-soniox-voices.mjs
//
// Or regenerate from a response already on disk, which needs no key and makes
// the formatting reproducible when reviewing a roster diff:
//
//   node scripts/fetch-soniox-voices.mjs --input shared-voices.json
//
// Order is Soniox's own, not sorted: the API returns voices grouped by accent
// family, which is the order the picker shows within a filter result.
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODEL = 'tts-rt-v2';
const OUT = join(process.cwd(), 'src', 'lib', 'soniox', 'sonioxVoiceRoster.ts');

const argv = process.argv.slice(2);
const inputAt = argv.indexOf('--input');
const inputPath = inputAt === -1 ? null : argv[inputAt + 1];

const key = process.env.SONIOX_API_KEY;
if (!key && !inputPath) {
  console.error(
    'SONIOX_API_KEY is required (a permanent project key; temporary keys are 401 here),\n' +
      'or pass --input <file> holding a GET /v1/shared-voices response.'
  );
  process.exit(1);
}

async function fetchAll() {
  const voices = [];
  let cursor = null;
  do {
    const url = new URL('https://api.soniox.com/v1/shared-voices');
    url.searchParams.set('model', MODEL);
    url.searchParams.set('limit', '200');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      console.error(`HTTP ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    const body = await res.json();
    voices.push(...body.voices);
    cursor = body.next_page_cursor ?? null;
  } while (cursor);
  return voices;
}

const esc = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const list = (xs) => `[${xs.map(esc).join(', ')}]`;

const voices = inputPath ? JSON.parse(readFileSync(inputPath, 'utf8')).voices : await fetchAll();
if (voices.length === 0) {
  console.error('Soniox returned an empty roster; refusing to write it.');
  process.exit(1);
}

// Every distinct facet value present, so the picker never hardcodes a
// vocabulary that Soniox can extend without telling us.
const distinct = (pick) => [...new Set(voices.flatMap(pick))].sort();
const accents = distinct((v) => [v.accent]);
const useCases = distinct((v) => v.use_case);
const styles = distinct((v) => v.style);

const rows = voices
  .map(
    (v) =>
      `  { id: ${esc(v.id)}, gender: ${esc(v.gender)}, age: ${esc(v.age)}, accent: ${esc(v.accent)},\n` +
      `    useCase: ${list(v.use_case)}, style: ${list(v.style)},\n` +
      `    description: ${esc(v.description)} },`
  )
  .join('\n');

const file = `/**
 * Soniox's built-in voice roster for \`${MODEL}\`, with the metadata its
 * voice library exposes: gender, perceived age, accent, use-case tags and
 * style tags.
 *
 * GENERATED — do not hand-edit. Re-run:
 *   SONIOX_API_KEY=snx_proj_... node scripts/fetch-soniox-voices.mjs
 * See that script for why this is a snapshot rather than a runtime fetch.
 *
 * Source: GET /v1/shared-voices?model=${MODEL}
 * Fetched: ${new Date().toISOString().slice(0, 10)} — ${voices.length} voices
 */

/** Perceived speaker gender, as Soniox classifies it. */
export type SonioxVoiceGender = 'male' | 'female' | 'neutral';

/** Perceived speaker age, as Soniox classifies it. */
export type SonioxVoiceAge = 'young' | 'middle_aged' | 'old';

export interface SonioxVoiceProfile {
  /** The string sent in the TTS \`voice\` field. Also the display label. */
  id: string;
  gender: SonioxVoiceGender;
  age: SonioxVoiceAge;
  /** Free-form in the API (e.g. \`american\`, \`british\`); see SONIOX_ACCENTS. */
  accent: string;
  /** What the voice is suited for (\`narration\`, \`conversational\`, …). */
  useCase: string[];
  /** How the voice sounds (\`warm\`, \`energetic\`, …). */
  style: string[];
  /** Soniox's own one-line character description. English only — Soniox
   *  publishes no translations, so the picker shows it verbatim. */
  description: string;
}

export const SONIOX_VOICE_ROSTER: SonioxVoiceProfile[] = [
${rows}
];

/** Every accent present in the roster, sorted. The picker builds its filter
 *  from this rather than a hardcoded list, so a roster refresh that adds an
 *  accent needs no UI change — only a label (see sonioxFacetLabels). */
export const SONIOX_ACCENTS: string[] = ${list(accents)};

/** Every use-case tag present in the roster, sorted. */
export const SONIOX_USE_CASES: string[] = ${list(useCases)};

/** Every style tag present in the roster, sorted. */
export const SONIOX_STYLES: string[] = ${list(styles)};
`;

writeFileSync(OUT, file);
console.log(
  `Wrote ${voices.length} voices to ${OUT}\n` +
    `  accents:   ${accents.length} (${accents.join(', ')})\n` +
    `  use cases: ${useCases.length} (${useCases.join(', ')})\n` +
    `  styles:    ${styles.length} (${styles.join(', ')})`
);
