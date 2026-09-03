// Drive a headless Chromium at the spike page over CDP and print RESULT lines.
// usage: node run_page.mjs <chrome-binary> <url> [timeoutSec] [extra chrome flags...]
// env: PROFILE_DIR (prefix for --user-data-dir), SHOW_GPU_LOG=1 (print GPU-related stderr lines)
// Works on Node >= 22 without dependencies (global WebSocket); falls back to the `ws` package.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let WS = globalThis.WebSocket;
if (!WS) {
  const { createRequire } = await import('node:module');
  WS = createRequire('/home/jiangzhuo/Desktop/kizunaai/sokuji/node_modules/')('ws');
}

const [chrome, url, timeoutArg, ...extra] = process.argv.slice(2);
const timeoutMs = (parseInt(timeoutArg || '900', 10)) * 1000;
const port = 9222 + Math.floor(Math.random() * 500);
const profile = `${process.env.PROFILE_DIR || join(tmpdir(), 'spike-chrome-profile')}-${port}`;
const linuxGpuFlags = process.platform === 'linux'
  ? ['--enable-features=Vulkan,WebGPU', '--use-angle=vulkan', '--enable-dawn-features=allow_unsafe_apis']
  : [];
const headless = process.env.NO_HEADLESS ? [] : ['--headless=new'];
const flags = [...headless, '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...linuxGpuFlags, '--window-size=800,600', ...extra, 'about:blank'];
const proc = spawn(chrome, flags, { stdio: ['ignore', 'pipe', 'pipe'] });
// Chrome must not outlive this script: a dropped SSH session (SIGHUP) or a timeout kill used to
// leave a headless Chrome behind, holding the model in its GPU process and contaminating the
// next run's memory measurements.
process.on('exit', () => { if (proc.exitCode === null) proc.kill('SIGKILL'); });
for (const sig of ['SIGHUP', 'SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(130));
let stderr = '';
proc.stderr.on('data', (d) => { stderr += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget() {
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('no CDP target; stderr tail: ' + stderr.slice(-800));
}

const wsUrl = await waitForTarget();
const ws = new WS(wsUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (text.startsWith('RESULT ') || text.startsWith('STATUS ')) console.log(text);
    else if (msg.params.type === 'error' || msg.params.type === 'warning') console.log('[console.' + msg.params.type + '] ' + text.slice(0, 500));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[exception] ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
  }
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url });
const start = Date.now();
let done = false;
while (Date.now() - start < timeoutMs) {
  await sleep(1000);
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify({done: window.__result?.done, n: window.__result?.clips?.length})', returnByValue: true });
  const v = r.result?.result?.value ? JSON.parse(r.result.result.value) : null;
  if (v?.done) { done = true; break; }
}
if (!done) console.log('TIMEOUT after ' + timeoutMs / 1000 + 's');
if (process.env.SHOW_GPU_LOG) console.log('[stderr gpu lines]\n' + stderr.split('\n').filter((l) => /vulkan|dawn|webgpu|gpu|angle/i.test(l)).slice(-25).join('\n'));
const fin = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__result)', returnByValue: true });
console.log('FINAL ' + (fin.result?.result?.value || 'null').slice(0, 20000));
ws.close();
proc.kill('SIGTERM');
await sleep(500);
process.exit(done ? 0 : 2);
