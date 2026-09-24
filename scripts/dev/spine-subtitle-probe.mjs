#!/usr/bin/env node
/**
 * Plays the development preview's fake session with both subtitle surfaces on
 * the page — the Electron-style view, and the overlay in an iframe fed over a
 * MessageChannel — and checks what each drew (plan 1d-2).
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-subtitle-probe.mjs [url] [seconds] [screenshot.png]
 *
 * Default url: http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1.
 * Add `&script=cjk&cut=sentences:1` (bands unspaced between CJK segments) or
 * `&turn=push-to-talk` (the probe holds the overlay's button for 1.5 s, and
 * the fake's first block must then reach both surfaces).
 *
 * Exits 1 unless both surfaces end with the same texts — with `&compact=1`
 * the bands (at least a source and a translation band), without it the
 * expanded list's rows (at least four) — the overlay lit karaoke at least
 * once, and:
 * for `script=cjk`, no ASCII space sits between two CJK characters in any
 * band; for `turn=`, the Electron view showed the Space hint and the overlay
 * its hold button before the press, and both drew bands after it.
 */
import { writeFileSync } from 'node:fs';
import { evaluate, sleep, withPage } from './headless.mjs';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1&subtitle=1&overlay=1&compact=1';
const seconds = Number(process.argv[3] ?? 12);
const screenshot = process.argv[4] ?? null;
const manual = /[?&]turn=push-to-/.test(url);
const cjk = url.includes('script=cjk');
// Declared before `READ` below: its template literal reads `compact`
// immediately (it is a plain string, not a function), so this must exist first.
const compact = url.includes('compact=1');

const READ = `(() => {
  // Compact: the band texts. Expanded: the list's row texts.
  const lines = (doc) => doc
    ? [...doc.querySelectorAll(${compact ? "'.subtitle-app .subtitle-stream__line'" : "'.subtitle-app .conversation-row .row-text'"})].map((l) => l.textContent)
    : null;
  const frame = document.querySelector('iframe.spine-overlay-frame');
  const inner = frame && frame.contentDocument;
  return {
    page: lines(document.querySelector('.spine-subtitle') ? document : null),
    overlay: lines(inner),
    lit: inner ? inner.querySelectorAll('.karaoke-played').length : 0,
    hint: !!document.querySelector('.spine-subtitle .subtitle-ptt-hint'),
    hold: !!(inner && inner.querySelector('.subtitle-hold__button')),
  };
})()`;

const HOLD = (type) => `(() => {
  const inner = document.querySelector('iframe.spine-overlay-frame')?.contentDocument;
  const button = inner && inner.querySelector('.subtitle-hold__button');
  if (!button) return false;
  button.dispatchEvent(new PointerEvent('${type}', { bubbles: true }));
  return true;
})()`;

const CJK_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}] [\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

process.exitCode = await withPage(url, async (send) => {
  const failures = [];
  let litEver = false;
  let before = null;
  let last = null;
  if (manual) {
    await sleep(3000);
    before = await evaluate(send, READ);
    if (!(await evaluate(send, HOLD('pointerdown')))) failures.push('no hold button to press');
    await sleep(1500);
    await evaluate(send, HOLD('pointerup'));
  }
  for (let waited = 0; waited < seconds * 1000; waited += 250) {
    await sleep(250);
    last = await evaluate(send, READ);
    if (last) litEver ||= last.lit > 0;
  }
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }
  const page = last?.page ?? [];
  const overlay = last?.overlay ?? [];
  console.log(`page ${compact ? 'bands' : 'rows'}: ${JSON.stringify(page)}`);
  console.log(`overlay ${compact ? 'bands' : 'rows'}: ${JSON.stringify(overlay)}`);
  console.log(`overlay karaoke: ${litEver ? 'lit' : 'never'}` + (manual ? ` · before the press: hint ${before?.hint}, hold ${before?.hold}` : ''));
  if (page.length < (compact ? 2 : 4)) failures.push(compact ? 'the page view drew fewer than two bands' : 'the page view drew fewer than four rows');
  if (JSON.stringify(page) !== JSON.stringify(overlay)) failures.push('the two surfaces drew different bands');
  if (!litEver) failures.push('the overlay never lit karaoke');
  if (cjk && [...page, ...overlay].some((text) => CJK_SPACE.test(text))) failures.push('a space sits between CJK characters');
  if (manual && !(before?.hint && before?.hold)) failures.push('before the press: no Space hint on the page view or no hold button on the overlay');
  for (const failure of failures) console.log(`FAIL: ${failure}`);
  return failures.length === 0 ? 0 : 1;
}, { viewport: { width: 1000, height: 2200 } });
