#!/usr/bin/env node
/**
 * Drives the new MainPanel headlessly (plan 1e-3b-1 Task 13): Start, rows with
 * karaoke, typed text, the export menu's .txt, Stop with its auto-save, the
 * advanced footer's waveforms, and a refused start's Settings action. Two
 * targets, the same checks:
 *
 *   --preview (default)  the development preview:
 *                        /?preview=spine&panel=1&script=cjk&autosave=1, plus
 *                        &turn=push-to-talk (--ptt), &script=long (--long),
 *                        &ui=advanced&capture=device (--advanced: the app's own
 *                        capture, whose level meters the mic strip reads — the
 *                        fake source bypasses them), &refuse=1 (--refuse)
 *   --app                the app itself at `/`, seeded as a finished setup on the
 *                        fake provider (plan 1e-3b-2's switch must have landed)
 * Flags: --advanced, --ptt (Space holds a turn), --long (the fake's `long`
 *        script: prints long-task totals, the row memoization's measurement),
 *        --refuse (preview only: a refused start's idle line and its action),
 *        --shot <file.png>.
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/app-panel-probe.mjs [origin] [flags]
 *
 * Exits 1 on any miss, printing each; 2 on a flag the target cannot serve.
 *
 * `--long`'s row check waits longer than the default (34s, not 12s): the
 * fake's `long` script paces one exchange every 3s (`longScript(500, 3000)`,
 * two rows per exchange), so 20 rows need on the order of 30s of real time —
 * the whole point of the script is to pile up enough rows to measure the
 * per-row memoization's long tasks, which a 12s window cannot show.
 *
 * `--ptt` holds Space right after Start, before the rows/karaoke check: the
 * fake's first block plays only inside a held turn under push-to-talk (the
 * same reason `spine-subtitle-probe.mjs` holds before reading), so the rows
 * check must come from that held turn, not before it. Without `--ptt`
 * nothing about the ordering changes.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, sleep, withPage } from './headless.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const shotIndex = args.indexOf('--shot');
const screenshot = shotIndex !== -1 ? args[shotIndex + 1] : null;
const origin = (args.find((a) => a.startsWith('http')) ?? 'http://localhost:5199').replace(/\/$/, '');

const appTarget = flag('--app');
const advanced = flag('--advanced');
const ptt = flag('--ptt');
const long = flag('--long');
const refuse = flag('--refuse');

if (refuse && appTarget) {
  console.log('the app has no refusing stand-in; use --preview');
  process.exit(2);
}

function targetUrl() {
  if (appTarget) return `${origin}/`;
  const params = new URLSearchParams();
  params.set('preview', 'spine');
  params.set('panel', '1');
  params.set('script', long ? 'long' : 'cjk');
  params.set('autosave', '1');
  if (ptt) params.set('turn', 'push-to-talk');
  if (advanced) { params.set('ui', 'advanced'); params.set('capture', 'device'); }
  if (refuse) params.set('refuse', '1');
  return `${origin}/?${params.toString()}`;
}
const url = targetUrl();

// Installed before navigation (`Page.addScriptToEvaluateOnNewDocument`), so
// no long task from the very first paint is missed.
const LONGTASK_SCRIPT = `(() => {
  window.__longTasks = { count: 0, max: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.count += 1;
        window.__longTasks.max = Math.max(window.__longTasks.max, entry.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask unsupported — count/max stay 0, and the probe reports it that way.
  }
})();`;

// `--app` only: a finished setup on the fake provider, seeded once per
// profile (a `sessionStorage` flag guards a reload from re-seeding over
// whatever the run itself has since written to `localStorage`).
const setupJson = JSON.stringify({
  version: 1,
  scenario: 'be-heard',
  providerPath: 'offline',
  provider: 'local_inference',
  completedAt: '2026-09-25T00:00:00.000Z',
});
const SEED_SCRIPT = `(() => {
  if (sessionStorage.getItem('app-panel-probe-seeded')) return;
  sessionStorage.setItem('app-panel-probe-seeded', '1');
  localStorage.setItem('settings.setup', ${JSON.stringify(setupJson)});
  localStorage.setItem('settings.common.provider', 'fake');
  localStorage.setItem('settings.fake.script', ${JSON.stringify(long ? 'long' : 'cjk')});
  localStorage.setItem('settings.common.autoSaveOnStop', 'true');
  localStorage.setItem('settings.common.uiMode', ${JSON.stringify(advanced ? 'advanced' : 'basic')});
  localStorage.setItem('settings.common.turnMode', ${JSON.stringify(ptt ? 'push-to-talk' : 'auto')});
})();`;

const downloads = mkdtempSync(join(tmpdir(), 'app-panel-probe-'));
const failures = [];

const click = (send, js) => evaluate(send, `(() => { const el = ${js}; if (!el) return false; el.click(); return true; })()`);
const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => el.textContent.includes(${JSON.stringify(text)}))`;

async function waitForFiles(dir, count, ms) {
  for (let waited = 0; waited < ms; waited += 250) {
    const done = readdirSync(dir).filter((f) => f.endsWith('.txt'));
    if (done.length >= count) return done.sort();
    await sleep(250);
  }
  return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
}

function checkExport(label, text) {
  if (!text.startsWith('Sokuji conversation export\n')) failures.push(`${label}: missing the header title`);
  if (!text.includes('\nProvider: fake\n')) failures.push(`${label}: missing the provider line`);
}

async function pollUntil(ms, step, check) {
  for (let waited = 0; waited < ms; waited += step) {
    await sleep(step);
    if (await check()) return true;
  }
  return false;
}

process.exitCode = await withPage('about:blank', async (send) => {
  // The download directory, before anything can download.
  const allowed = await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  if (allowed.error) await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  // Before navigation: the long-task observer, and (--app) the seeded setup —
  // `about:blank` above is what leaves room for this ordering under `withPage`.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: LONGTASK_SCRIPT });
  if (appTarget) await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_SCRIPT });
  await send('Page.navigate', { url });

  // Step 2: the start button reaches enabled.
  let enabled = false;
  let title = '';
  await pollUntil(10000, 250, async () => {
    const state = await evaluate(send, `(() => {
      const el = document.querySelector('.main-panel [data-tour="main-action"]');
      return el ? { enabled: !el.disabled, title: el.title || '' } : null;
    })()`);
    if (!state) return false;
    title = state.title;
    enabled = state.enabled;
    return enabled;
  });

  if (!enabled) {
    failures.push(`the start button stayed disabled: ${title || '(no title)'}`);
  } else {
    // Step 3: click it.
    if (!(await click(send, `document.querySelector('.main-panel [data-tour="main-action"]')`))) {
      failures.push('no start button to click');
    } else if (refuse) {
      // The refused start's notice must be the list's LAST CHILD, not merely
      // the last `.message-bubble.error` on the page — a weaker selector
      // could not tell a genuine "nothing else in the list" from "a notice
      // happens to sort last among several" (review minor).
      const refused = await pollUntil(3000, 250, async () => evaluate(send, `(() => {
        const list = document.querySelector('.main-panel .conversation-list');
        const last = list ? list.lastElementChild : null;
        if (!last || !last.classList.contains('message-bubble') || !last.classList.contains('error')) return false;
        const action = last.querySelector('.message-action');
        const noActive = !document.querySelector('.main-panel .status-dot.active');
        return !!(action && action.textContent === 'Settings' && noActive);
      })()`));
      if (!refused) failures.push("the refused start did not draw a notice with a Settings action as the list's last child");
    } else {
      const started = await pollUntil(5000, 250, async () => evaluate(send, `(() => {
        const active = document.querySelector('.main-panel .status-dot.active');
        const duration = document.querySelector('.main-panel .session-duration');
        return !!(active && duration && /^\\d\\d:\\d\\d/.test(duration.textContent || ''));
      })()`));
      if (!started) failures.push('the run never showed an active status dot with a duration');

      // `--ptt`, right after Start and before step 4 (fix round 2): under
      // push-to-talk the fake's first block plays only inside a held turn,
      // so step 4's rows/karaoke must come from this held turn, not before
      // it — the basic footer's own words ("Hold to speak" / "Release to
      // stop"). Holds 1.5s total, as `spine-subtitle-probe.mjs` does.
      if (ptt) {
        // Off any focused element, so Space is not swallowed as typing (usePushToTalk's own rule).
        await evaluate(send, `document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
        const holdText = () => evaluate(send, `document.querySelector('.main-panel .push-to-talk-btn .btn-text')?.textContent ?? ''`);
        const holdStarted = Date.now();
        await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
        const released = await pollUntil(1000, 100, async () => (await holdText()).startsWith('Release'));
        if (!released) failures.push('the hold button never read "Release…" after Space down');
        const remaining = 1500 - (Date.now() - holdStarted);
        if (remaining > 0) await sleep(remaining);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ', windowsVirtualKeyCode: 32 });
        const heldAgain = await pollUntil(1000, 100, async () => (await holdText()).startsWith('Hold'));
        if (!heldAgain) failures.push('the hold button never read "Hold…" again after Space up');
      }

      // Step 4: rows with karaoke. `--long` needs a much longer window (see
      // the header comment) to actually pile up 20 rows.
      const rowsWindowMs = long ? 34000 : 12000;
      let rowsOk = false;
      let karaokePolls = 0;
      for (let waited = 0; waited < rowsWindowMs; waited += 100) {
        await sleep(100);
        const state = await evaluate(send, `(() => {
          const list = document.querySelector('.main-panel .conversation-list');
          return {
            text: list ? list.textContent : '',
            rows: list ? list.querySelectorAll('.conversation-row').length : 0,
            lit: list ? list.querySelectorAll('.karaoke-played').length : 0,
          };
        })()`);
        if (!state) continue;
        if (state.lit > 0) karaokePolls += 1;
        if (!rowsOk) rowsOk = long ? state.rows >= 20 : state.text.includes('今天天气很好。我们去公园吧。');
      }
      if (!rowsOk) failures.push(long ? 'never drew 20 rows' : 'the cjk translation never appeared in the row list');
      if (karaokePolls < 1) failures.push('karaoke never lit a row');

      // Step 5: typed text.
      const hasInput = await pollUntil(3000, 250, async () => evaluate(send, `!!document.querySelector('.main-panel .text-input')`));
      if (!hasInput) {
        failures.push('no .text-input in the panel');
      } else {
        await evaluate(send, `(() => {
          const input = document.querySelector('.main-panel .text-input');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'probe text');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        })()`);
        const sent = await pollUntil(5000, 250, async () => evaluate(send, `document.querySelector('.main-panel .conversation-list')?.textContent.includes('probe text') ?? false`));
        if (!sent) failures.push('the typed text never reached a row');
      }

      // Step 7: the advanced footer's waveforms — the app's own capture, not the fake source.
      if (advanced) {
        const strips = await evaluate(send, `document.querySelectorAll('.main-panel .waveform-strip canvas').length`);
        if ((strips ?? 0) < 2) failures.push(`expected at least two waveform strips, got ${strips ?? 0}`);
        let micLit = false;
        await pollUntil(4000, 250, async () => {
          const nonTransparent = await evaluate(send, `(() => {
            const canvas = document.querySelector('.main-panel .waveform-strip--mic canvas');
            if (!canvas || !canvas.width || !canvas.height) return 0;
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
            return count;
          })()`);
          micLit ||= (nonTransparent ?? 0) > 0;
          return micLit;
        });
        if (!micLit) failures.push('the mic waveform strip never painted a non-transparent pixel');
      }

      // Step 8: export the .txt while the run is on. `manual` (the files it
      // saved, if any) feeds step 9's "a different file" check below; it
      // stays `[]` when the export button or menu item was never found, so
      // step 9 still runs and is independently reported (review minor: Stop
      // must not be skipped just because export failed).
      let manual = [];
      if (!(await click(send, `document.querySelector('.main-panel .export-btn')`))) {
        failures.push('no export button in the panel');
      } else {
        await sleep(300);
        if (!(await click(send, byText('[role="menuitem"]', 'Download as .txt')))) failures.push('no "Download as .txt" in the menu');
        manual = await waitForFiles(downloads, 1, 5000);
        if (manual.length < 1) failures.push('the export menu saved no file');
        else checkExport('export menu', readFileSync(join(downloads, manual[0]), 'utf8'));
      }

      // Step 9: Stop — a different second, so the auto-saved file gets its
      // own name. Independent of step 8's outcome.
      await sleep(1100);
      if (!(await click(send, `document.querySelector('.main-panel [data-tour="main-action"]')`))) {
        failures.push('no Stop button to click');
      } else {
        const stopped = await pollUntil(8000, 250, async () => evaluate(send, `!document.querySelector('.main-panel .status-dot.active')`));
        if (!stopped) failures.push('the run never stopped (status dot stayed active)');
        const all = await waitForFiles(downloads, manual.length + 1, 8000);
        const saved = all.filter((f) => !manual.includes(f));
        if (saved.length < 1) failures.push('stopping the run wrote no auto-save file');
        else checkExport('auto-save', readFileSync(join(downloads, saved[0]), 'utf8'));
      }
    }
  }

  // Step 10: long tasks (informational; a single hung frame still fails).
  const longTasks = (await evaluate(send, 'window.__longTasks')) ?? { count: 0, max: 0 };
  console.log(`long tasks: ${longTasks.count}, longest: ${Math.round(longTasks.max)} ms`);
  if (longTasks.max > 500) failures.push(`the longest task ran ${Math.round(longTasks.max)}ms — a hung frame, not a slow one`);

  // Step 11.
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }

  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    return 1;
  }
  console.log(`ok — ${appTarget ? '--app' : '--preview'}${advanced ? ' --advanced' : ''}${ptt ? ' --ptt' : ''}${long ? ' --long' : ''}${refuse ? ' --refuse' : ''} (files in ${downloads})`);
  return 0;
}, { flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], viewport: { width: 1000, height: 1400 } });
