#!/usr/bin/env node
/**
 * Plays the development preview's fake session in headless Chromium and
 * prints what its playback did: the clips its queues played and the loudest
 * sample the tts tap heard (the page's `[data-probe=playback]` line).
 *
 *   SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # another shell
 *   node scripts/dev/spine-audio-probe.mjs ['http://localhost:5199/?preview=spine&autostart=1&capture=device'] [seconds]
 *
 * Exits 1 when no clip played or the tap heard nothing; with `capture=device`,
 * the fake microphone is captured too, and it must deliver.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5199/?preview=spine&autostart=1';
const seconds = Number(process.argv[3] ?? 12);
const cache = join(homedir(), '.cache', 'ms-playwright');
const build = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
if (!build) throw new Error(`no Playwright chromium under ${cache}`);
const port = 9333;
const browser = spawn(join(cache, build, 'chrome-linux', 'chrome'), [
  '--headless', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spine-probe-'))}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocketUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error('chromium did not come up');
}

try {
  const ws = new WebSocket(await pageSocketUrl());
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let nextId = 0;
  const waiting = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(seconds * 1000);
  const reply = await send('Runtime.evaluate', {
    expression: 'document.querySelector("[data-probe=playback]")?.textContent ?? ""',
    returnByValue: true,
  });
  const text = reply.result?.result?.value ?? '';
  console.log(text || 'no playback probe on the page');
  const heard = /heard: (\S+)/.exec(text)?.[1] ?? '-';
  const peak = Number(/tap peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const deviceCapture = url.includes('capture=device');
  const chunks = Number(/captured: (\d+)/.exec(text)?.[1] ?? 0);
  const micPeak = Number(/mic peak: ([\d.]+)/.exec(text)?.[1] ?? 0);
  const captureOk = !deviceCapture || (chunks > 0 && micPeak > 0);
  process.exitCode = heard !== '-' && peak > 0 && captureOk ? 0 : 1;
  ws.close();
} finally {
  browser.kill();
}
