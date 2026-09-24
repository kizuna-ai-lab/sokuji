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
 * once, the page view lit karaoke at least once too, and:
 * for `script=cjk`, no ASCII space sits between two CJK characters in any
 * band; for `turn=`, the Electron view showed the Space hint and the overlay
 * its hold button before the press, and both drew bands after it; in every
 * compact band, on both surfaces, no two consecutive `.subtitle-stream__item`
 * spans carry the same segment (a within-segment gap); in the expanded body,
 * on both surfaces, `.conversation-display`'s computed background is
 * transparent (the subtitle's own background must show through, not an
 * opaque panel).
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
  // Final-review Important 1: one .subtitle-stream__item per segment run —
  // two adjacent items of the same band must never carry the same
  // data-segment (that is the within-segment gap rendering as spacing).
  const noAdjacentDuplicateSegments = (doc) => {
    if (!doc) return true;
    for (const line of doc.querySelectorAll('.subtitle-app .subtitle-stream__line')) {
      const items = [...line.querySelectorAll('.subtitle-stream__item')];
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1].getAttribute('data-segment');
        const cur = items[i].getAttribute('data-segment');
        if (prev && prev === cur) return false;
      }
    }
    return true;
  };
  // Final-review Important 2: the expanded body's .conversation-display must
  // stay transparent so the subtitle's own background shows through.
  // Returns null when the element isn't there (compact mode draws no
  // .conversation-display), true when transparent, or the offending computed
  // color otherwise.
  const transparentBg = (doc) => {
    const el = doc && doc.querySelector('.subtitle-app .conversation-display');
    if (!el) return null;
    const bg = doc.defaultView.getComputedStyle(el).backgroundColor;
    return bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' ? true : bg;
  };
  return {
    page: lines(document.querySelector('.spine-subtitle') ? document : null),
    overlay: lines(inner),
    lit: inner ? inner.querySelectorAll('.karaoke-played').length : 0,
    litPage: document.querySelectorAll('.spine-subtitle .karaoke-played').length,
    hint: !!document.querySelector('.spine-subtitle .subtitle-ptt-hint'),
    hold: !!(inner && inner.querySelector('.subtitle-hold__button')),
    segmentsOk: { page: noAdjacentDuplicateSegments(document), overlay: noAdjacentDuplicateSegments(inner) },
    bg: { page: transparentBg(document), overlay: transparentBg(inner) },
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
  let litPageEver = false;
  const segmentsBad = { page: false, overlay: false };
  const bgBad = { page: null, overlay: null };
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
    if (!last) continue;
    litEver ||= last.lit > 0;
    litPageEver ||= last.litPage > 0;
    if (last.segmentsOk.page === false) segmentsBad.page = true;
    if (last.segmentsOk.overlay === false) segmentsBad.overlay = true;
    if (last.bg.page !== null && last.bg.page !== true) bgBad.page = last.bg.page;
    if (last.bg.overlay !== null && last.bg.overlay !== true) bgBad.overlay = last.bg.overlay;
  }
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }
  const page = last?.page ?? [];
  const overlay = last?.overlay ?? [];
  console.log(`page ${compact ? 'bands' : 'rows'}: ${JSON.stringify(page)}`);
  console.log(`overlay ${compact ? 'bands' : 'rows'}: ${JSON.stringify(overlay)}`);
  console.log(`overlay karaoke: ${litEver ? 'lit' : 'never'}; page karaoke: ${litPageEver ? 'lit' : 'never'}` + (manual ? ` · before the press: hint ${before?.hint}, hold ${before?.hold}` : ''));
  if (page.length < (compact ? 2 : 4)) failures.push(compact ? 'the page view drew fewer than two bands' : 'the page view drew fewer than four rows');
  if (JSON.stringify(page) !== JSON.stringify(overlay)) failures.push('the two surfaces drew different bands');
  if (!litEver) failures.push('the overlay never lit karaoke');
  if (!litPageEver) failures.push('the page view never lit karaoke');
  if (cjk && [...page, ...overlay].some((text) => CJK_SPACE.test(text))) failures.push('a space sits between CJK characters');
  if (manual && !(before?.hint && before?.hold)) failures.push('before the press: no Space hint on the page view or no hold button on the overlay');
  if (segmentsBad.page) failures.push('two adjacent items in one band share a segment on the page view (a within-segment gap)');
  if (segmentsBad.overlay) failures.push('two adjacent items in one band share a segment on the overlay (a within-segment gap)');
  if (bgBad.page) failures.push(`the page view's .conversation-display is not transparent: ${bgBad.page}`);
  if (bgBad.overlay) failures.push(`the overlay's .conversation-display is not transparent: ${bgBad.overlay}`);
  for (const failure of failures) console.log(`FAIL: ${failure}`);
  return failures.length === 0 ? 0 : 1;
}, { viewport: { width: 1000, height: 2200 } });
