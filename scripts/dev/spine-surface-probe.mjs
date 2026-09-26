#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * checks what the conversation list drew (plan 1d-1): rows with text, the
 * headers, karaoke lit at least once and at least once strictly mid-row
 * (never a whole-clip jump — finding I1), notices in words — and saves a
 * screenshot to look at.
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-surface-probe.mjs [url] [seconds] [screenshot.png]
 *
 * Default url: http://localhost:5199/?preview=spine&autostart=1. Others worth
 * running: `&script=cjk&cut=sentences:1` (rows tile CJK text) and
 * `&script=notices` (a notice among the rows).
 *
 * Exits 1 unless the list ended with exactly four rows and one header, never
 * drew a blank row, lit karaoke at least once and at least once strictly
 * partial, and — for the default and `notices` scripts, whose two exchanges
 * each stay whole — drew its source and translation rows in the order src,
 * tr, src, tr. (`script=cjk` runs with `&cut=sentences:1`, cutting its one
 * exchange into two rows per side, so source rows precede translation rows as
 * a group instead — the badge-order check does not apply there.) For
 * `script=cjk`, no row's text has an ASCII space between two CJK characters.
 * For `script=notices`, exactly one notice, reading in the notice's own
 * words rather than the adapter's raw English.
 */
import { writeFileSync } from 'node:fs';
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1';
const seconds = Number(process.argv[3] ?? 12);
const screenshot = process.argv[4] ?? null;

// `NOTICE_WORDS.tts_degraded` (src/lib/view/noticeText.ts) and
// `notices.tts_degraded` (src/locales/en/translation.json) — kept in sync by
// noticeText.test.ts. The `notices` script's raw adapter message is "The fake
// degraded its speech (script)."; the list must show these words instead.
const TTS_DEGRADED_WORDS = 'Speech playback is degraded; the translated text still arrives.';

/** A CJK character (Han, Hiragana, Katakana, or CJK/fullwidth symbols) directly beside an ASCII space and another CJK character. */
const CJK_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯] [\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

const READ = `(() => {
  const rows = [...document.querySelectorAll('.conversation-display .conversation-row')];
  const rowText = (r) => r.querySelector('.row-text')?.textContent ?? '';
  const partialRow = rows.some((r) => {
    const played = r.querySelector('.row-text .karaoke-played');
    const next = played?.nextElementSibling;
    return !!next && (next.textContent ?? '').length > 0;
  });
  return {
    rows: rows.length,
    headers: document.querySelectorAll('.conversation-display .row-header').length,
    blank: rows.filter((r) => rowText(r).trim() === '').length,
    lit: document.querySelectorAll('.conversation-display .karaoke-played').length,
    partialRow,
    rowTexts: rows.map(rowText),
    badgeSides: rows.map((r) => {
      const badge = r.querySelector('.lang-badge');
      return badge?.classList.contains('src') ? 'src' : badge?.classList.contains('tr') ? 'tr' : '';
    }),
    notices: [...document.querySelectorAll('.conversation-display .message-bubble.error')].map(
      (b) => b.querySelector('.message-content')?.textContent ?? '',
    ),
    texts: rows.map((r) => (r.querySelector('.lang-badge')?.textContent ?? '') + ' ' + rowText(r)),
  };
})()`;

process.exitCode = await withPage(url, async (send) => {
  let last = { rows: 0, headers: 0, blank: 0, lit: 0, partialRow: false, rowTexts: [], badgeSides: [], notices: [], texts: [] };
  let litEver = false;
  let blankEver = false;
  let partialEver = false;
  for (let waited = 0; waited < seconds * 1000; waited += 250) {
    await sleep(250);
    const now = await evaluate(send, READ);
    if (!now) continue;
    litEver ||= now.lit > 0;
    blankEver ||= now.blank > 0;
    partialEver ||= now.partialRow;
    last = now;
  }
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }
  console.log(`rows: ${last.rows} · headers: ${last.headers} · karaoke: ${litEver ? 'lit' : 'never'} · notices: ${last.notices.length} · blank rows: ${blankEver ? 'seen' : 'none'}`);
  for (const text of last.texts) console.log(`  | ${text}`);

  const isCjk = url.includes('script=cjk');
  const isNotices = url.includes('script=notices');
  const failures = [];
  if (last.rows !== 4) failures.push(`expected exactly 4 rows, got ${last.rows}`);
  if (last.headers !== 1) failures.push(`expected exactly 1 header, got ${last.headers}`);
  if (blankEver) failures.push('a blank row was drawn');
  if (!litEver) failures.push('karaoke never lit');
  if (!partialEver) failures.push('karaoke never sampled strictly mid-row (a whole-clip jump — finding I1)');
  if (!isCjk) {
    const want = ['src', 'tr', 'src', 'tr'];
    if (JSON.stringify(last.badgeSides) !== JSON.stringify(want)) {
      failures.push(`badge order was [${last.badgeSides.join(', ')}], not src, tr, src, tr`);
    }
  }
  if (isCjk) {
    const spaced = last.rowTexts.find((t) => CJK_SPACE.test(t));
    if (spaced !== undefined) failures.push(`an ASCII space sat between two CJK characters: "${spaced}"`);
  }
  if (isNotices) {
    if (last.notices.length !== 1) failures.push(`expected exactly one notice, got ${last.notices.length}`);
    else if (last.notices[0] !== TTS_DEGRADED_WORDS) failures.push(`the notice did not read in words: "${last.notices[0]}"`);
  } else if (last.notices.length !== 0) {
    failures.push(`expected no notices, got ${last.notices.length}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    return 1;
  }
  return 0;
}, { viewport: { width: 900, height: 1600 } });
