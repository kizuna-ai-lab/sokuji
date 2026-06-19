/**
 * Minimal Chrome CDP driver (#263): launch system google-chrome (headed on the
 * existing X display so the real NVIDIA GPU + WebGPU is available), navigate to a
 * URL, evaluate an async probe expression until it resolves, print the result JSON.
 *
 * Usage: node scripts/chrome-drive.mjs <url> <probeFile> [timeoutMs]
 *   probeFile = path to a .js file whose contents are an async IIFE-able expression
 *               returning a JSON-serializable value when the page work is done.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const [url, probeFile, timeoutMsArg] = process.argv.slice(2);
const timeoutMs = parseInt(timeoutMsArg || '120000', 10);
const probe = readFileSync(probeFile, 'utf8');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('/usr/bin/google-chrome', [
  '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/chrome-webgpu-profile',
  `--remote-debugging-port=${PORT}`,
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--ignore-gpu-blocklist',
  '--disable-gpu-sandbox',
  url,
], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' }, stdio: 'ignore' });

let ws;
async function main() {
  // Wait for the devtools endpoint, then find the page target.
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.includes(url.split('?')[0].split('/').pop()));
      if (!target) target = list.find((t) => t.type === 'page' && t.url.startsWith('http'));
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('no chrome page target');

  ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

  let id = 0;
  const pending = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params) => new Promise((res) => { const myId = ++id; pending.set(myId, res); ws.send(JSON.stringify({ id: myId, method, params })); });

  await send('Runtime.enable', {});
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${probe} })()`,
    awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  });
  if (r.result?.exceptionDetails || r.result?.result?.subtype === 'error') {
    console.log(JSON.stringify({ error: r.result.exceptionDetails || r.result.result }, null, 2));
  } else {
    console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 2));
  }
}

main()
  .catch((e) => console.log(JSON.stringify({ driverError: e.message })))
  .finally(() => { try { ws?.close(); } catch {} chrome.kill('SIGKILL'); setTimeout(() => process.exit(0), 300); });
