#!/usr/bin/env node
/**
 * The extension's subtitle overlay in a meeting page, headless (plan 1e-4
 * Task 9, ruling 7). The chain, one link at a time — a link that fails stops
 * the probe with its evidence:
 *
 *   1. a development build of the extension (the fake provider is compiled
 *      into development builds only), `vite build --mode development` in
 *      `extension/`, into --build-dir;
 *   2. Playwright's Chromium with --load-extension, driven over the browser's
 *      own DevTools socket with flat sessions, every target in the default
 *      browser context (extensions are off in any other);
 *   3. a stand-in meeting page at https://meet.google.com/sokuji-probe, in a
 *      window of its own, served by the browser itself through `Fetch`
 *      interception — the content scripts match real hosts over HTTPS only,
 *      and no DNS, TLS or server is involved;
 *   4. the side panel's page, fullpage.html?tabId=<the meeting tab>, in
 *      another window (a real side panel needs a user gesture; `?tabId=` makes
 *      `enter()` target the meeting tab), seeded as a finished setup on the
 *      fake's `long` script, the side panel's language `ja`;
 *   5. Start, the subtitle button, and the overlay's own CDP session: a
 *      cross-origin frame inside a closed shadow root, announced by the
 *      meeting page's auto-attach.
 *
 * Then the checks, in order: (--ptt) a trusted mouse hold on the overlay's
 * hold button, first, since under push-to-talk nothing plays before a held
 * turn ends; the overlay draws the run (a `long` text, and karaoke lit); the
 * virtual microphone's PCM reaches the meeting page; (--ptt) where Space and
 * Escape go after a hold — recorded, not failed; whether the overlay shares
 * the extension's storage (a sentinel written in the side panel only), and
 * the side panel's language on the overlay once the run stops; Escape in the
 * overlay exits subtitle mode; closing the side panel unmounts the overlay.
 * Without --ptt, a two-panel case follows: a second meeting tab with its own
 * side panel on the fake's `exchange` script — each overlay must draw its own
 * tab's session only; what an overlay shows once its own panel closes while
 * the other panel lives (and whether Escape still dismisses it), and once
 * both have closed, is recorded.
 *
 * The side panel's page also records the `sender` of every `sokuji-subtitle`
 * port it hears (a listener that keeps no reference to the port, beside the
 * surface's own): the surface accepts an overlay only when `sender.tab.id` is
 * its meeting tab (ruling 4), and no unit test can see what Chrome sets there.
 *
 *   node scripts/dev/extension-overlay-probe.mjs [--ptt] [--shot file.png] [--no-build] [--build-dir dir]
 *
 * --ptt        the side panel on push-to-talk; Chrome's fake microphone plays
 *              benchmark/test-speech-silence-speech.wav, since a beep is too
 *              little voice for MIN_VOICED_MS and the held turn would be
 *              cancelled
 * --shot       the meeting page with the overlay up, right after the draw check
 * --no-build   reuse --build-dir as it is
 * --build-dir  where the development build goes (default: <tmpdir>/sokuji-extension-probe);
 *              each run's throwaway browser profile is made beside it and removed
 *
 * Exits 1 on any miss (and on a link of the chain that fails), 2 on a flag it
 * cannot serve.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from './headless.mjs';

const USAGE = 'usage: node scripts/dev/extension-overlay-probe.mjs [--ptt] [--shot file.png] [--no-build] [--build-dir dir]';

function parseArgs(argv) {
  const out = { ptt: false, noBuild: false, shot: null, buildDir: join(tmpdir(), 'sokuji-extension-probe') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ptt') out.ptt = true;
    else if (arg === '--no-build') out.noBuild = true;
    else if (arg === '--shot' || arg === '--build-dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return { error: `${arg} needs a value` };
      i += 1;
      if (arg === '--shot') out.shot = resolve(value);
      else out.buildDir = resolve(value);
    } else {
      return { error: `unknown argument ${arg}` };
    }
  }
  return out;
}

const options = parseArgs(process.argv.slice(2));
if (options.error) {
  console.log(options.error);
  console.log(USAGE);
  process.exit(2);
}
if (options.noBuild && !existsSync(join(options.buildDir, 'manifest.json'))) {
  console.log(`--no-build: no extension build at ${options.buildDir}`);
  process.exit(2);
}

// Resolved from this script's own path, never the process cwd.
const EXTENSION_DIR = fileURLToPath(new URL('../../extension/', import.meta.url));
const FAKE_AUDIO_FIXTURE = fileURLToPath(new URL('../../benchmark/test-speech-silence-speech.wav', import.meta.url));
const JA = JSON.parse(readFileSync(new URL('../../src/locales/ja/translation.json', import.meta.url), 'utf8'));

const PORT = 9334;
const MEETING_URL = 'https://meet.google.com/sokuji-probe';
const SECOND_MEETING_URL = 'https://meet.google.com/sokuji-probe-2';
// `src/providers/fake/generate.ts` (`long`) and `scripts.ts` (`exchange`).
const LONG_TEXTS = ['今日は天気がいいですね。', 'The weather is nice today.'];
const LONG_ALL = [...LONG_TEXTS, '公園に行きましょう。', 'Let us go to the park.', 'ついでに買い物もします。', 'And do some shopping on the way.'];
const EXCHANGE_TEXTS = ['Hello, how are you?', 'こんにちは、お元気ですか？'];
// Longer than the fixture's 2 s of silence, so any hold carries at least 1 s of
// voice (MIN_VOICED_MS is 500): where the looped file stands when the button is
// pressed is not the probe's to choose.
const HOLD_MS = 3000;

const STUB = `<!doctype html><html><head><title>Meeting stand-in</title></head><body>
<p>Sokuji extension overlay probe — a stand-in for a meeting page.</p>
<script>
  window.__keys = [];
  window.__pcm = 0;
  window.addEventListener('keydown', (e) => window.__keys.push(e.key), true);
  window.addEventListener('message', (e) => { if (e.data && e.data.type === 'PCM_DATA') window.__pcm += 1; });
</script>
</body></html>`;

const SEED = {
  'settings.setup': { version: 1, scenario: 'be-heard', providerPath: 'offline', provider: 'local_inference', completedAt: '2026-09-25T00:00:00.000Z' },
  'settings.common.provider': 'fake',
  'settings.fake.script': 'long',
  'settings.common.uiMode': 'basic',
  'settings.common.turnMode': options.ptt ? 'push-to-talk' : 'auto',
};

// Every `sokuji-subtitle` port this document hears, with what Chrome says sent it.
const PORT_RECORDER = `(() => {
  if (window.__probePorts) return true;
  window.__probePorts = [];
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sokuji-subtitle') return;
    window.__probePorts.push({ tabId: port.sender?.tab?.id ?? null, url: port.sender?.url ?? null, frameId: port.sender?.frameId ?? null });
  });
  return true;
})()`;

const failures = [];
const miss = (text) => failures.push(text);

async function pollUntil(ms, step, check) {
  for (let waited = 0; waited < ms; waited += step) {
    const value = await check();
    if (value) return value;
    await sleep(step);
  }
  return false;
}

class LinkFailed extends Error {}
const noGo = (link, why) => { throw new LinkFailed(`no-go at link ${link}: ${why}`); };

// ─── Link 1: a development build ──────────────────────────────────────────

function buildExtension() {
  const run = spawnSync('npx', ['vite', 'build', '--mode', 'development', '--outDir', options.buildDir, '--emptyOutDir'], {
    cwd: EXTENSION_DIR, encoding: 'utf8',
  });
  if (run.status !== 0 || !existsSync(join(options.buildDir, 'manifest.json'))) {
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
    noGo(1, `the development build exited ${run.status ?? run.signal}${run.error ? ` (${run.error.message})` : ''}:\n${tail}`);
  }
}

// ─── Link 2: Chromium with the extension, over the browser socket ─────────

function launchChromium(profile) {
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const build = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
  if (!build) noGo(2, `no Playwright chromium under ${cache}`);
  return spawn(join(cache, build, 'chrome-linux', 'chrome'), [
    '--headless', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    // A window that is not in front must not throttle its timers or its renderer.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(options.ptt ? [`--use-file-for-fake-audio-capture=${FAKE_AUDIO_FIXTURE}`] : []),
    `--load-extension=${options.buildDir}`, `--disable-extensions-except=${options.buildDir}`,
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
}

async function connectBrowser() {
  let socketUrl = null;
  for (let i = 0; i < 75 && !socketUrl; i++) {
    try {
      socketUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
    } catch {
      await sleep(200);
    }
  }
  if (!socketUrl) noGo(2, `chromium did not answer on port ${PORT}`);
  const ws = new WebSocket(socketUrl);
  await new Promise((done, fail) => {
    ws.addEventListener('open', done, { once: true });
    ws.addEventListener('error', () => fail(new LinkFailed('no-go at link 2: the browser socket would not open')), { once: true });
  });
  let nextId = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  ws.addEventListener('close', () => {
    for (const settle of waiting.values()) settle({ error: { message: 'the browser socket closed' } });
    waiting.clear();
  });
  // A reply that never comes settles as an error: an input event whose frame
  // goes away while it is handled — Escape unmounting the overlay — is never
  // acknowledged.
  const send = (method, params = {}, sessionId = undefined) => new Promise((settle) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      waiting.delete(id);
      settle({ error: { message: `${method}: no reply in 10 s` } });
    }, 10000);
    waiting.set(id, (reply) => {
      clearTimeout(timer);
      settle(reply);
    });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
  return { send, on: (listener) => listeners.add(listener), close: () => ws.close() };
}

/** One attached target: its commands carry its session id. */
function sessionOf(cdp, sessionId, targetId) {
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return reply.result?.result?.value;
  };
  return { sessionId, targetId, send, evaluate };
}

async function main(cdp) {
  // Every frame an attached page announces (auto-attach), keyed by the page's session.
  const attached = [];
  const STUB_BODY = Buffer.from(STUB, 'utf8').toString('base64');
  cdp.on((message) => {
    if (message.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = message.params;
      attached.push({ parent: message.sessionId ?? null, sessionId, targetId: targetInfo.targetId, type: targetInfo.type });
    } else if (message.method === 'Fetch.requestPaused') {
      // The browser serves the meeting host itself: the document is the stub, anything else a 404.
      const { requestId, resourceType } = message.params;
      void cdp.send('Fetch.fulfillRequest', resourceType === 'Document'
        ? { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: STUB_BODY }
        : { requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: '' }, message.sessionId);
    }
  });

  // Link 2: the extension's id, from its service worker. Chromium ships a
  // component extension with a `background.js` of its own ("Gemini in
  // Chrome"), so each candidate's manifest says which one is Sokuji.
  let lastTargets = [];
  const extensionId = await pollUntil(10000, 250, async () => {
    lastTargets = (await cdp.send('Target.getTargets')).result?.targetInfos ?? [];
    for (const worker of lastTargets.filter((t) => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(t.url))) {
      const attach = await cdp.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
      if (!attach.result) continue;
      const sidePanel = await sessionOf(cdp, attach.result.sessionId, worker.targetId).evaluate('chrome.runtime.getManifest().side_panel?.default_path ?? null');
      await cdp.send('Target.detachFromTarget', { sessionId: attach.result.sessionId });
      if (sidePanel === 'fullpage.html') return new URL(worker.url).host;
    }
    return null;
  });
  if (!extensionId) noGo(2, `no chrome-extension://<id>/background.js service worker within 10 s; targets: ${JSON.stringify(lastTargets.map((t) => [t.type, t.url]))}`);
  console.log(`extension loaded: ${extensionId}`);
  const OVERLAY_URL = `chrome-extension://${extensionId}/subtitle-overlay.html`;

  async function openTarget(url) {
    const created = await cdp.send('Target.createTarget', { url, newWindow: true });
    if (!created.result) return { error: created.error };
    const attach = await cdp.send('Target.attachToTarget', { targetId: created.result.targetId, flatten: true });
    if (!attach.result) return { error: attach.error };
    const target = sessionOf(cdp, attach.result.sessionId, created.result.targetId);
    await target.send('Page.enable');
    return target;
  }

  // Link 3: a stand-in meeting page, in a window of its own.
  async function openMeeting(url) {
    const meeting = await openTarget('about:blank');
    if (meeting.error) noGo(3, `Target.createTarget: ${JSON.stringify(meeting.error)}`);
    await meeting.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    const fetchOn = await meeting.send('Fetch.enable', { patterns: [{ urlPattern: 'https://meet.google.com/*' }] });
    if (fetchOn.error) noGo(3, `Fetch.enable: ${JSON.stringify(fetchOn.error)}`);
    await meeting.send('Page.navigate', { url });
    const committed = await pollUntil(10000, 200, () => meeting.evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Array.isArray(window.__keys)`));
    if (!committed) noGo(3, `the page never committed at ${url}; it reads ${JSON.stringify(await meeting.evaluate('location.href'))}`);
    // content.js injects the virtual microphone's page script: the content scripts ran here.
    const injected = await pollUntil(3000, 200, () => meeting.evaluate(`!!document.getElementById('sokuji-virtual-microphone-script')`));
    if (!injected) noGo(3, `the content scripts never injected into ${url}`);
    return meeting;
  }

  // Link 4: the side panel's stand-in, fullpage.html?tabId=<the meeting tab>, in another window.
  async function openPanel(meetingUrl, { seed, language, sentinel }) {
    const panel = await openTarget(`chrome-extension://${extensionId}/fullpage.html`);
    if (panel.error) noGo(4, `Target.createTarget(fullpage.html): ${JSON.stringify(panel.error)}`);
    const BOOT = `({ href: location.href, ready: document.readyState, storage: typeof chrome !== 'undefined' && !!chrome.storage, root: document.getElementById('root')?.childElementCount ?? null })`;
    let boot = null;
    const booted = await pollUntil(15000, 200, async () => {
      boot = await panel.evaluate(BOOT);
      return boot?.ready === 'complete' && boot.storage && boot.root > 0;
    });
    if (!booted) noGo(4, `fullpage.html never booted: ${JSON.stringify(boot)}`);
    const tabs = await panel.evaluate(`chrome.tabs.query({ url: 'https://meet.google.com/*' }).then((tabs) => tabs.map((t) => ({ id: t.id, url: t.url })))`);
    const tabId = (tabs ?? []).find((t) => t.url === meetingUrl)?.id;
    if (tabId === undefined) noGo(4, `chrome.tabs.query found no tab at ${meetingUrl}: ${JSON.stringify(tabs)}`);
    if (seed) {
      const seeded = await panel.evaluate(`chrome.storage.sync.set(${JSON.stringify(seed)}).then(() => true)`);
      if (!seeded) noGo(4, 'chrome.storage.sync.set never resolved');
    }
    if (language) await panel.evaluate(`localStorage.setItem('i18nextLng', ${JSON.stringify(language)})`);
    // In this document only (controller ruling I5): the overlay reading it back means shared storage.
    if (sentinel) await panel.evaluate(`localStorage.setItem('sokuji-probe-shared', '1')`);
    await panel.send('Page.navigate', { url: `chrome-extension://${extensionId}/fullpage.html?tabId=${tabId}` });
    let title = '';
    const ready = await pollUntil(15000, 250, async () => {
      const state = await panel.evaluate(`(() => {
        if (!location.search.includes('tabId=${tabId}')) return null;
        const el = document.querySelector('[data-tour="main-action"]');
        return el ? { enabled: !el.disabled, title: el.title || '' } : null;
      })()`);
      title = state?.title ?? title;
      return state?.enabled;
    });
    if (!ready) noGo(4, `[data-tour="main-action"] was not enabled within 15 s: ${title || '(no title)'}`);
    await panel.evaluate(PORT_RECORDER);
    return { ...panel, tabId };
  }

  const click = async (panel, selector) => {
    await panel.send('Page.bringToFront');
    return panel.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`);
  };
  const running = (panel) => pollUntil(8000, 250, () => panel.evaluate(`!!document.querySelector('.status-dot.active')`));
  const hasHost = (meeting) => meeting.evaluate(`!!document.getElementById('sokuji-subtitle-host')`);
  const hostGone = (meeting, ms) => pollUntil(ms, 100, async () => (await hasHost(meeting)) === false);

  /** A new overlay frame under `meeting` — one not in `known` — once it has loaded the overlay page. */
  async function waitForOverlay(meeting, known, ms = 5000) {
    return pollUntil(ms, 100, async () => {
      for (const frame of attached) {
        if (frame.parent !== meeting.sessionId || frame.type !== 'iframe' || known.has(frame.targetId)) continue;
        const overlay = sessionOf(cdp, frame.sessionId, frame.targetId);
        if ((await overlay.evaluate('location.href')) === OVERLAY_URL && (await hasHost(meeting))) {
          known.add(frame.targetId);
          return overlay;
        }
      }
      return null;
    });
  }

  async function enterSubtitles(panel, meeting, known, link) {
    if (!(await click(panel, '[data-tour="subtitle-enter"]'))) noGo(link, 'no enabled [data-tour="subtitle-enter"] to click');
    const overlay = await waitForOverlay(meeting, known);
    if (!overlay) {
      const frames = attached.filter((f) => f.parent === meeting.sessionId).map((f) => f.type);
      const toast = await panel.evaluate(`document.body.innerText.slice(-300)`);
      noGo(link, `within 5 s: host ${await hasHost(meeting) ? 'mounted' : 'absent'}; frames attached under the meeting page: ${JSON.stringify(frames)}; the side panel's text ends ${JSON.stringify(toast)}`);
    }
    return overlay;
  }

  const overlayText = (overlay) => overlay.evaluate(`document.querySelector('.subtitle-app')?.textContent ?? ''`);

  // ─── The chain ──────────────────────────────────────────────────────────

  const meeting = await openMeeting(MEETING_URL);
  console.log(`meeting stand-in committed at ${MEETING_URL}, content scripts in`);
  let panel = await openPanel(MEETING_URL, { seed: SEED, language: 'ja', sentinel: true });
  console.log(`side panel stand-in: fullpage.html?tabId=${panel.tabId}`);

  // Link 5: the run and the overlay.
  if (!(await click(panel, '[data-tour="main-action"]'))) noGo(5, 'no main action to click');
  if (!(await running(panel))) noGo(5, 'the run never showed .status-dot.active');
  const known = new Set();
  let overlay = await enterSubtitles(panel, meeting, known, 5);
  // The overlay opens its port once its display settings have hydrated, a
  // moment after its page loads. Without `sender.tab` the side panel ignores
  // every overlay (ruling 4, the Task 6 ruling) and nothing below can draw.
  const ports = await pollUntil(3000, 100, async () => {
    const heard = await panel.evaluate('window.__probePorts');
    return heard?.length ? heard : null;
  });
  const senderTab = ports ? ports[0].tabId : undefined;
  console.log(`the overlay's port carries sender.tab.id ${JSON.stringify(senderTab ?? null)} (the meeting tab is ${panel.tabId}); sender as heard: ${JSON.stringify(ports || [])}`);
  if (senderTab !== panel.tabId) miss(`the overlay's port carried sender.tab.id ${JSON.stringify(senderTab ?? null)}, not the meeting tab ${panel.tabId}: the side panel ignores it`);

  // ─── The checks ─────────────────────────────────────────────────────────

  // 0. --ptt: a trusted hold, first.
  let releasedAt = null;
  if (options.ptt) {
    await meeting.send('DOM.getDocument', { depth: 0 });
    const owner = await meeting.send('DOM.getFrameOwner', { frameId: overlay.targetId });
    const box = owner.result ? await meeting.send('DOM.getBoxModel', { backendNodeId: owner.result.backendNodeId }) : owner;
    const button = await pollUntil(5000, 100, () => overlay.evaluate(`(() => {
      const r = document.querySelector('.subtitle-hold__button')?.getBoundingClientRect();
      return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    })()`));
    if (!box.result) {
      miss(`the overlay iframe's box: ${JSON.stringify(box.error)}`);
    } else if (!button) {
      miss('the overlay never drew .subtitle-hold__button');
    } else {
      const [left, top] = box.result.model.content;
      const x = left + button.x;
      const y = top + button.y;
      await meeting.send('Page.bringToFront');
      await meeting.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await meeting.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      const pressedAt = Date.now();
      const held = await pollUntil(HOLD_MS - 200, 100, () => overlay.evaluate(`!!document.querySelector('.subtitle-hold__button.is-held')`));
      if (!held) miss('the hold button never carried .is-held while the mouse held it');
      const remaining = HOLD_MS - (Date.now() - pressedAt);
      if (remaining > 0) await sleep(remaining);
      await meeting.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      releasedAt = Date.now();
      console.log(`held the overlay's button at (${Math.round(x)}, ${Math.round(y)}) for ${HOLD_MS} ms`);
    }
  }

  // 1. The overlay draws the run.
  const drawn = await pollUntil(options.ptt ? 8000 : 15000, 250, async () => {
    const text = await overlayText(overlay);
    return LONG_TEXTS.some((t) => text.includes(t));
  });
  const firstTextAt = Date.now();
  if (!drawn) {
    miss(`the overlay never drew a long-script text; .subtitle-app reads ${JSON.stringify((await overlayText(overlay)).slice(0, 200))}`);
  } else if (releasedAt) {
    console.log(`first text ${firstTextAt - releasedAt} ms after the release`);
  }
  // The ten seconds after the first text serve checks 1 and 2 at once.
  let litPolls = 0;
  let pcm = 0;
  for (let waited = 0; waited < 10000; waited += 100) {
    if ((await overlay.evaluate(`document.querySelectorAll('.karaoke-played').length`)) > 0) litPolls += 1;
    if (waited % 500 === 0) pcm = (await meeting.evaluate('window.__pcm')) || 0;
    await sleep(100);
  }
  if (litPolls < 1) miss('the overlay never lit karaoke (.karaoke-played) in 10 s');
  else console.log(`karaoke lit in ${litPolls} of 100 polls`);

  // 7. --shot: the overlay at 140 px in a page, right after the draw check.
  if (options.shot) {
    await meeting.send('Page.bringToFront');
    const shot = await meeting.send('Page.captureScreenshot', { format: 'png' });
    if (shot.result) writeFileSync(options.shot, Buffer.from(shot.result.data, 'base64'));
    else miss(`Page.captureScreenshot: ${JSON.stringify(shot.error)}`);
  }

  // 2. The virtual microphone reaches the meeting tab (tabMicrophone.ts → content.js → the page).
  if (!pcm) miss('no PCM_DATA reached the meeting page within 10 s of the first text');
  else console.log(`PCM_DATA messages the meeting page saw within 10 s of the first text: ${pcm}`);

  // 3. --ptt: where the keyboard goes after a hold — recorded, not failed.
  if (options.ptt && releasedAt) {
    const heldPolls = async (ms) => {
      let seen = false;
      for (let waited = 0; waited < ms; waited += 50) {
        seen ||= await overlay.evaluate(`!!document.querySelector('.subtitle-hold__button.is-held')`);
        await sleep(50);
      }
      return seen;
    };
    await meeting.send('Page.bringToFront');
    await meeting.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
    const heldBySpace = await heldPolls(400);
    await meeting.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await sleep(200);
    const spaceReached = await meeting.evaluate(`window.__keys.includes(' ')`);
    console.log(`after a hold, Space reached the page: ${spaceReached ? 'yes' : 'no'}; the overlay's hold button held meanwhile: ${heldBySpace ? 'yes' : 'no'}`);
    if (heldBySpace) miss('a Space after the hold held the overlay\'s button — it kept focus');

    await meeting.send('Page.bringToFront');
    // Not awaited: when Escape exits subtitle mode, the frame that took it goes
    // away, and Chrome never acknowledges the event.
    const escapeDown = meeting.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const exited = await hostGone(meeting, 2000);
    const escapeUp = meeting.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const acks = await Promise.race([Promise.all([escapeDown, escapeUp]), sleep(1000).then(() => null)]);
    if (!acks) console.log('  (Chrome never acknowledged the Escape key events: the frame that took them was unmounted)');
    const escapeReached = await meeting.evaluate(`window.__keys.includes('Escape')`);
    console.log(`after a hold, Escape reached the page: ${escapeReached ? 'yes' : 'no'}; subtitle mode exited: ${exited ? 'yes' : 'no'}`);
    if (exited) overlay = await enterSubtitles(panel, meeting, known, 'check 3 (re-entering)');
  }

  // 4. Whether storage is shared, and the language.
  const shared = await overlay.evaluate(`localStorage.getItem('sokuji-probe-shared') === '1'`);
  console.log(`extension storage shared with the overlay: ${shared ? 'yes' : 'no'}`);
  if (!(await click(panel, '[data-tour="main-action"]'))) {
    miss('no main action to click for Stop');
  } else {
    const want = JA.subtitle.sessionEnded;
    let idle = '';
    const ended = await pollUntil(5000, 200, async () => {
      idle = await overlay.evaluate(`document.querySelector('.subtitle-idle__message')?.textContent ?? ''`);
      return idle === want;
    });
    if (!ended) miss(`after Stop the overlay's .subtitle-idle__message read ${JSON.stringify(idle)}, expected ${JSON.stringify(want)}`);
    else console.log(`after Stop the overlay reads ${JSON.stringify(idle)} (the side panel's ja)`);
    if (shared) console.log("  storage is shared: this cannot tell the wire's language from the overlay's own detection, which reads the same i18nextLng; the unit tests of Tasks 1 and 5 carry the wire's proof");
    else console.log('  storage is partitioned: the Japanese words came over the wire');
  }

  // 5. Exit from the overlay.
  if (!(await click(panel, '[data-tour="main-action"]')) || !(await running(panel))) {
    miss('the run never restarted for the exit check');
  } else {
    await overlay.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    const gone = await hostGone(meeting, 3000);
    const inactive = await pollUntil(3000, 100, () => panel.evaluate(`!document.querySelector('[data-tour="subtitle-enter"]')?.classList.contains('is-active')`));
    if (!gone) miss('Escape in the overlay left #sokuji-subtitle-host mounted after 3 s');
    if (!inactive) miss('Escape in the overlay left the side panel\'s subtitle button active after 3 s');
  }

  // 6. The side panel going away.
  overlay = await enterSubtitles(panel, meeting, known, 'check 6');
  await cdp.send('Target.closeTarget', { targetId: panel.targetId });
  if (!(await hostGone(meeting, 3000))) miss('closing the side panel left #sokuji-subtitle-host mounted after 3 s (no sidepanel-gone)');

  // The two-panel case (plan 1e-4 review M12; the Task 6 ruling).
  if (!options.ptt) {
    const second = await openMeeting(SECOND_MEETING_URL);
    const panelA = await openPanel(MEETING_URL, {});
    if (!(await click(panelA, '[data-tour="main-action"]')) || !(await running(panelA))) noGo('two panels', "panel A's run never started");
    const overlayA = await enterSubtitles(panelA, meeting, known, 'two panels');
    // Panel A keeps `long` in memory; panel B boots on `exchange`.
    await panelA.evaluate(`chrome.storage.sync.set({ 'settings.fake.script': 'exchange' }).then(() => true)`);
    const panelB = await openPanel(SECOND_MEETING_URL, {});
    if (!(await click(panelB, '[data-tour="main-action"]')) || !(await running(panelB))) noGo('two panels', "panel B's run never started");
    const overlayB = await enterSubtitles(panelB, second, known, 'two panels');

    const read = async () => ({ a: await overlayText(overlayA), b: await overlayText(overlayB) });
    let both = { a: '', b: '' };
    await pollUntil(15000, 250, async () => {
      both = await read();
      return LONG_ALL.some((t) => both.a.includes(t)) && EXCHANGE_TEXTS.some((t) => both.b.includes(t));
    });
    const aOwn = LONG_ALL.some((t) => both.a.includes(t));
    const aForeign = EXCHANGE_TEXTS.some((t) => both.a.includes(t));
    const bOwn = EXCHANGE_TEXTS.some((t) => both.b.includes(t));
    const bForeign = LONG_ALL.some((t) => both.b.includes(t));
    console.log(`two panels: overlay A draws its own tab's session: ${aOwn ? 'yes' : 'no'}, the other's: ${aForeign ? 'yes' : 'no'}; overlay B its own: ${bOwn ? 'yes' : 'no'}, the other's: ${bForeign ? 'yes' : 'no'}`);
    if (!aOwn || aForeign || !bOwn || bForeign) miss(`two panels: each overlay must draw its own tab's session only — A reads ${JSON.stringify(both.a.slice(0, 160))}, B reads ${JSON.stringify(both.b.slice(0, 160))}`);
    console.log(`  ports heard — panel A: ${JSON.stringify(await panelA.evaluate('window.__probePorts'))}; panel B: ${JSON.stringify(await panelB.evaluate('window.__probePorts'))}`);

    // Panel B goes while panel A lives. Overlay B opened its port after panel A
    // was already listening, so panel A holds an unheld receiving end of it:
    // the Task 6 ruling's stated cost is overlay B showing its last state
    // until the user exits. (Overlay A opened before panel B listened; only
    // panel A ever heard it.)
    await cdp.send('Target.closeTarget', { targetId: panelB.targetId });
    await sleep(3000);
    const bHost = await hasHost(second);
    const aHost = await hasHost(meeting);
    const bShows = bHost ? await overlayB.evaluate(`({
      entries: [...document.querySelectorAll('.subtitle-stream__line')].map((l) => l.textContent),
      idle: document.querySelector('.subtitle-idle__message')?.textContent ?? null,
    })`) : null;
    console.log(`two panels, B closed while A lives (3 s): overlay A mounted: ${aHost ? 'yes' : 'no'}; overlay B mounted: ${bHost ? 'yes' : 'no'}${bShows ? ` — it shows ${bShows.idle !== null ? `the idle message ${JSON.stringify(bShows.idle)}` : `entries ${JSON.stringify(bShows.entries)}`}` : ''}`);
    if (!aHost) miss('two panels: closing panel B unmounted overlay A, whose panel lives');
    if (bHost) {
      // Its exit goes out on its port, and no one holding the port listens.
      await overlayB.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      console.log(`  Escape in the orphaned overlay B unmounts it: ${(await hostGone(second, 2000)) ? 'yes' : 'no'}`);
    }

    await cdp.send('Target.closeTarget', { targetId: panelA.targetId });
    const aGone = await hostGone(meeting, 3000);
    const bGone = await hostGone(second, 3000);
    console.log(`two panels, both closed (3 s): overlay A unmounted: ${aGone ? 'yes' : 'no'}; overlay B unmounted: ${bGone ? 'yes' : 'no'}`);
    if (!aGone) miss('two panels: closing panel A left overlay A mounted (no sidepanel-gone)');
    if (!bGone) miss('two panels: with both panels closed, overlay B stayed mounted');
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────

if (!options.noBuild) {
  try {
    buildExtension();
  } catch (error) {
    console.log(error.message);
    process.exit(1);
  }
  console.log(`development build in ${options.buildDir}`);
}
const profile = mkdtempSync(join(dirname(options.buildDir), 'sokuji-extension-probe-profile-'));
let browser = null;
let exited = Promise.resolve();
let cdp = null;
try {
  browser = launchChromium(profile);
  exited = new Promise((done) => {
    browser.once('exit', done);
    // A binary that will not start: the socket below never answers, and link 2 says so.
    browser.once('error', done);
  });
  cdp = await connectBrowser();
  await main(cdp);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`FAIL: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`ok — extension overlay${options.ptt ? ' --ptt' : ''}`);
    process.exitCode = 0;
  }
} catch (error) {
  for (const failure of failures) console.log(`FAIL: ${failure}`);
  console.log(error instanceof LinkFailed ? error.message : `the probe threw: ${error?.stack ?? error}`);
  process.exitCode = 1;
} finally {
  // Closed the browser's own way, so the profile is not still being written while it is removed.
  if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(3000)]);
  cdp?.close();
  if (!(await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]))) browser?.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
