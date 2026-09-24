/**
 * Headless Chromium over the DevTools protocol, for the development
 * preview's checks. Uses the Chromium Playwright caches under
 * ~/.cache/ms-playwright and Node's global WebSocket (Node 22+).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocketUrl(port) {
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

/**
 * Opens `url` in a fresh headless Chromium (its own profile, so nothing
 * persists between runs) and hands `fn` a `send(method, params)`; returns what
 * `fn` returns, and always closes the browser.
 */
export async function withPage(url, fn, { port = 9333, flags = [], viewport = null } = {}) {
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const build = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
  if (!build) throw new Error(`no Playwright chromium under ${cache}`);
  const browser = spawn(join(cache, build, 'chrome-linux', 'chrome'), [
    '--headless', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', ...flags,
    `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spine-probe-'))}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await pageSocketUrl(port));
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
    try {
      await send('Page.enable');
      if (viewport) await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url });
      return await fn(send);
    } finally {
      ws.close();
    }
  } finally {
    browser.kill();
  }
}

/** The value of `expression` in the page. */
export async function evaluate(send, expression) {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
  return reply.result?.result?.value;
}
