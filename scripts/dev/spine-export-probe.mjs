#!/usr/bin/env node
/**
 * Plays the preview's `cjk` script in headless Chromium and exports it two
 * ways (plan 1d-3): the export menu's "Download as .txt" while the run is
 * on, and the session-end auto-save after Stop. Both files must carry the
 * header, the run's provider and models, and one block with the source
 * whole (no space inside the Japanese) and its translation. Then a refused
 * start (`&refuse=1`) must leave the idle line in words.
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-export-probe.mjs [origin] [screenshot.png]
 *
 * Default origin: http://localhost:5199. Exits 1 on any miss.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, sleep, withPage } from './headless.mjs';

const origin = process.argv[2] ?? 'http://localhost:5199';
const screenshot = process.argv[3] ?? null;
// `NOTICE_WORDS.no_provider` (src/lib/view/noticeText.ts).
const NO_PROVIDER_WORDS = 'Choose a provider in Settings before starting.';
const BLOCK = /\[\d{2}:\d{2}:\d{2}\] Me\n  今日は天気がいいですね。公園に行きましょう。\n  → 今天天气很好。我们去公园吧。\n/;

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

function check(label, text, failures) {
  const want = [
    ['the header title', text.startsWith('Sokuji conversation export\n')],
    ['the provider', text.includes('\nProvider: fake\n')],
    ['the models', text.includes('\nModels: asr=fake, translation=fake, tts=fake\n')],
    ['the block', BLOCK.test(text)],
  ];
  for (const [what, ok] of want) if (!ok) failures.push(`${label}: missing ${what}`);
}

const failures = [];
const downloads = mkdtempSync(join(tmpdir(), 'spine-export-'));

await withPage(`${origin}/?preview=spine&autostart=1&script=cjk&autosave=1`, async (send) => {
  const allowed = await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  if (allowed.error) await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  // Until the cjk exchange's translation is drawn whole, then a beat for the source to close.
  for (let waited = 0; waited < 12000; waited += 250) {
    await sleep(250);
    if (await evaluate(send, `!!document.querySelector('.spine-conversation .conversation-display')?.textContent.includes('我们去公园吧。')`)) break;
  }
  await sleep(1000);
  if (!(await click(send, `document.querySelector('.spine-conversation .export-btn')`))) failures.push('no export button in the panel');
  await sleep(300);
  if (!(await click(send, byText('[role="menuitem"]', 'Download as .txt')))) failures.push('no "Download as .txt" in the menu');
  const manual = await waitForFiles(downloads, 1, 5000);
  if (manual.length < 1) failures.push('the export menu saved no file');
  else check('export menu', readFileSync(join(downloads, manual[0]), 'utf8'), failures);
  await sleep(1100); // a different second, so the auto-saved file gets its own name
  if (!(await click(send, byText('button', 'Stop')))) failures.push('no Stop button');
  const all = await waitForFiles(downloads, 2, 8000);
  const saved = all.filter((f) => !manual.includes(f));
  if (saved.length < 1) failures.push('the run ended but auto-save wrote no file');
  else check('auto-save', readFileSync(join(downloads, saved[0]), 'utf8'), failures);
  if (screenshot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(screenshot, Buffer.from(shot.result.data, 'base64'));
  }
});

await withPage(`${origin}/?preview=spine&autostart=1&refuse=1`, async (send) => {
  let words = [];
  for (let waited = 0; waited < 8000 && words.length === 0; waited += 250) {
    await sleep(250);
    words = (await evaluate(send, `[...document.querySelectorAll('.conversation-display .message-bubble.error .message-content')].map((b) => b.textContent)`)) ?? [];
  }
  if (!words.includes(NO_PROVIDER_WORDS)) failures.push(`the refused start drew ${JSON.stringify(words)}, not the idle line`);
});

console.log(failures.length === 0 ? `ok — both files and the idle line (files in ${downloads})` : failures.join('\n'));
process.exitCode = failures.length === 0 ? 0 : 1;
