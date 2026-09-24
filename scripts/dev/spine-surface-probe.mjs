#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * checks what the conversation list drew (plan 1d-1): rows with text, the
 * headers, karaoke lit at least once, notices — and saves a screenshot to
 * look at.
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-surface-probe.mjs [url] [seconds] [screenshot.png]
 *
 * Default url: http://localhost:5199/?preview=spine&autostart=1. Others worth
 * running: `&script=cjk&cut=sentences:1` (rows tile CJK text) and
 * `&script=notices` (a notice among the rows).
 *
 * Exits 1 unless the list ended with at least four rows, never drew a blank
 * row, lit karaoke at least once, and — for `script=notices` — drew a notice.
 */
import { writeFileSync } from 'node:fs';
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1';
const seconds = Number(process.argv[3] ?? 12);
const screenshot = process.argv[4] ?? null;

const READ = `(() => {
  const rows = [...document.querySelectorAll('.conversation-display .conversation-row')];
  return {
    rows: rows.length,
    headers: document.querySelectorAll('.conversation-display .row-header').length,
    blank: rows.filter((r) => (r.querySelector('.row-text')?.textContent ?? '').trim() === '').length,
    lit: document.querySelectorAll('.conversation-display .karaoke-played').length,
    notices: document.querySelectorAll('.conversation-display .message-bubble.error').length,
    texts: rows.map((r) => (r.querySelector('.lang-badge')?.textContent ?? '') + ' ' + (r.querySelector('.row-text')?.textContent ?? '')),
  };
})()`;

process.exitCode = await withPage(url, async (send) => {
  let last = { rows: 0, headers: 0, blank: 0, lit: 0, notices: 0, texts: [] };
  let litEver = false;
  let blankEver = false;
  for (let waited = 0; waited < seconds * 1000; waited += 250) {
    await sleep(250);
    const now = await evaluate(send, READ);
    if (!now) continue;
    litEver ||= now.lit > 0;
    blankEver ||= now.blank > 0;
    last = now;
  }
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }
  console.log(`rows: ${last.rows} · headers: ${last.headers} · karaoke: ${litEver ? 'lit' : 'never'} · notices: ${last.notices} · blank rows: ${blankEver ? 'seen' : 'none'}`);
  for (const text of last.texts) console.log(`  | ${text}`);
  const wantsNotice = url.includes('script=notices');
  return last.rows >= 4 && !blankEver && litEver && (!wantsNotice || last.notices > 0) ? 0 : 1;
}, { viewport: { width: 900, height: 1600 } });
