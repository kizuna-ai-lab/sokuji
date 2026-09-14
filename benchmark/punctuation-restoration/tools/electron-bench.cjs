// Run www/bench.mjs inside a real Electron renderer (the app's own Electron build and
// GPU switches) and report per-process working set alongside the page's numbers.
// usage (with tools/serve.mjs running):
//   <sokuji>/node_modules/electron/dist/electron tools/electron-bench.cjs \
//     'http://127.0.0.1:8787/?model=pcs47&ep=wasm&threads=1'
// Prints one `ELECTRON {...}` JSON line and exits.
const { app, BrowserWindow } = require('electron');

// Mirror electron/main.js for an X11 Linux session.
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan,SharedArrayBuffer');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const url = process.argv.find((a) => a.startsWith('http'));
const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? 600000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { backgroundThrottling: false } });
  const rendererPid = () => win.webContents.getOSProcessId();
  const snapshot = () => {
    const metrics = app.getAppMetrics();
    const renderer = metrics.find((m) => m.pid === rendererPid());
    const gpu = metrics.find((m) => m.type === 'GPU');
    return {
      rendererKB: renderer?.memory.workingSetSize ?? null,
      gpuKB: gpu?.memory.workingSetSize ?? null,
      totalKB: metrics.reduce((s, m) => s + m.memory.workingSetSize, 0),
    };
  };
  const marks = {};
  let peak = { rendererKB: 0, gpuKB: 0, totalKB: 0 };
  let pageResult = null;
  const sampler = setInterval(() => {
    const s = snapshot();
    for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], s[k] ?? 0);
  }, 200);

  win.webContents.on('console-message', (...args) => {
    // Electron >= 35 passes one details object; older versions pass (event, level, message).
    const message = typeof args[0]?.message === 'string' ? args[0].message : args[2];
    const level = typeof args[0]?.level === 'string' ? args[0].level : args[1];
    if (typeof message !== 'string') return;
    if (message.startsWith('STATUS ')) marks[message.slice(7)] = snapshot();
    else if (message.startsWith('RESULT ')) pageResult = JSON.parse(message.slice(7));
    else if (level === 'error' || level === 3 || level === 'warning' || level === 2) console.error(`[page] ${message.slice(0, 400)}`);
  });

  const started = Date.now();
  await win.loadURL(url);
  while (!pageResult && Date.now() - started < timeoutMs) await new Promise((r) => setTimeout(r, 250));
  clearInterval(sampler);
  const gpuInfo = await app.getGPUInfo('basic').catch(() => null);
  console.log(`ELECTRON ${JSON.stringify({
    url,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    timedOut: !pageResult,
    marks,
    peak,
    gpu: gpuInfo?.gpuDevice?.map((d) => ({ vendorId: d.vendorId, deviceId: d.deviceId, active: d.active })) ?? null,
    page: pageResult,
  })}`);
  app.exit(0);
});
