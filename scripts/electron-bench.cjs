/**
 * Electron renderer bench driver (#263). Opens a real BrowserWindow at the bench
 * URL (onnxruntime-web WASM path, same as the browser extension), polls window.__bench
 * via executeJavaScript, prints the result, and quits. Measures the WASM path in
 * Electron's renderer (the actual desktop Chromium) vs standalone Chrome / native node.
 *
 * Usage: electron scripts/electron-bench.cjs "<benchUrl>" [timeoutMs]
 */
const { app, BrowserWindow } = require('electron');

// CPU WASM bench: no GPU needed; avoid /dev/shm + GPU-process crashes in this env.
// Keep the SUID sandbox (this Electron build is happiest with it).
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-gpu');

const url = process.argv[2];
const timeoutMs = parseInt(process.argv[3] || '120000', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let result = null;
  try {
    const win = new BrowserWindow({
      width: 900, height: 700, show: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    win.focus();
    console.log('BENCH_INFO chromium=' + process.versions.chrome + ' electron=' + process.versions.electron);
    await win.loadURL(url);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const b = await win.webContents.executeJavaScript('window.__bench ? {done:window.__bench.done,error:window.__bench.error,result:window.__bench.result} : null');
        if (b && b.done) { result = b; break; }
      } catch (e) { /* page not ready */ }
      await sleep(1000);
    }
  } catch (e) {
    console.log('BENCH_DRIVER_ERROR ' + (e && e.message ? e.message : String(e)));
  }
  console.log('BENCH_RESULT ' + JSON.stringify(result));
  app.quit();
});

// Don't quit on window-all-closed before we print.
app.on('window-all-closed', () => {});
