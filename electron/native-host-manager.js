const path = require('path');
const fs = require('fs');

function resolvePython() {
  if (process.env.SOKUJI_SIDECAR_PYTHON) return process.env.SOKUJI_SIDECAR_PYTHON;
  const venv = path.join(__dirname, '..', 'sidecar', '.venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

// Launch order for the sidecar interpreter (spec D10):
//   1. SOKUJI_SIDECAR_PYTHON env override (developer / manual testing)
//   2. installed self-contained bundle under userData/sidecar/<sku>
//   3. dev venv fallback (repo checkout - current behavior)
// Pure + injectable (platform / existsSync) so it is unit-testable off-Electron.
function resolveSidecarLaunch({ platform, envOverride, bundleRoot, devVenvPython, devCwd, existsSync }) {
  if (envOverride) return { python: envOverride, cwd: devCwd, source: 'env' };
  if (bundleRoot) {
    const bundlePython = platform === 'win32'
      ? path.join(bundleRoot, 'python', 'python.exe')
      : path.join(bundleRoot, 'python', 'bin', 'python3');
    if (existsSync(bundlePython)) {
      return { python: bundlePython, cwd: path.join(bundleRoot, 'app'), source: 'bundle' };
    }
  }
  return { python: devVenvPython, cwd: devCwd, source: 'venv' };
}

function parseHandshake(line) {
  try {
    const obj = JSON.parse(line);
    return typeof obj.port === 'number' ? obj.port : null;
  } catch {
    return null;
  }
}

class NativeHostManager {
  constructor() {
    this.proc = null;
    this.port = null;
    this._starting = null;
  }

  start() {
    if (this.port) return Promise.resolve({ port: this.port });
    if (this._starting) return this._starting;
    this._starting = new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const readline = require('readline');
      const { app } = require('electron');
      // Respect a pre-set HF_HOME (e.g. populated by sidecar/setup.sh) so manual
      // testing reuses the same model cache; otherwise isolate under userData.
      const hfHome = process.env.HF_HOME || path.join(app.getPath('userData'), 'hf-cache');
      const envOverride = process.env.SOKUJI_SIDECAR_PYTHON;
      // Skip SKU detection / userData resolution entirely when an explicit
      // override is set: resolveSidecarLaunch ignores bundleRoot in that case
      // anyway, and this keeps start() usable without a live Electron `app`
      // (dev/manual testing, unit tests) - mirrors the HF_HOME short-circuit above.
      let bundleRoot = null;
      if (!envOverride) {
        const { detectSku, probeNvidia, bundleRootFor } = require('./sidecar-sku');
        const sku = detectSku(process.platform, { hasNvidia: probeNvidia(), arch: process.arch });
        // sku is null on unsupported hardware (e.g. Intel mac) — no bundle to
        // resolve; fall through to the dev-venv launch path below.
        if (sku !== null) {
          const userData = process.env.SOKUJI_USERDATA || app.getPath('userData');
          bundleRoot = bundleRootFor(userData, sku);
        }
      }
      const launch = resolveSidecarLaunch({
        platform: process.platform,
        envOverride,
        bundleRoot,
        devVenvPython: resolvePython(),
        devCwd: path.join(__dirname, '..', 'sidecar'),
        existsSync: fs.existsSync,
      });
      // No CUDA/cuDNN LD_LIBRARY_PATH surgery: the sidecar pins them in-process
      // via onnxruntime.preload_dlls() at startup (spec D8).
      const env = { ...process.env, HF_HOME: hfHome };
      const child = spawn(launch.python, ['-m', 'sokuji_sidecar'], {
        cwd: launch.cwd, env,
      });
      this.proc = child;
      const rl = readline.createInterface({ input: child.stdout });
      const onLine = (line) => {
        const port = parseHandshake(line);
        if (port) { this.port = port; rl.off('line', onLine); resolve({ port }); }
      };
      rl.on('line', onLine);
      child.stderr.on('data', (d) => console.error('[Sokuji] [native-host]', d.toString().trim()));
      child.on('exit', (code) => {
        console.warn('[Sokuji] [native-host] exited', code);
        this.proc = null; this.port = null; this._starting = null;
      });
      child.on('error', (err) => { this._starting = null; reject(err); });
      setTimeout(() => {
        if (!this.port) {
          try { child.kill(); } catch (_) {}
          this.proc = null;
          this.port = null;
          this._starting = null;
          reject(new Error('native-host handshake timeout'));
        }
      }, 30000);
    });
    return this._starting;
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch (_) {} }
    this.proc = null; this.port = null; this._starting = null;
  }

  status() { return { running: !!this.proc, port: this.port }; }

  registerIpc(ipcMain) {
    ipcMain.handle('native-host:start', async () => {
      try { return { ok: true, ...(await this.start()) }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    ipcMain.handle('native-host:stop', () => { this.stop(); return { ok: true }; });
    ipcMain.handle('native-host:status', () => ({ ok: true, ...this.status() }));
  }
}

module.exports = { resolvePython, resolveSidecarLaunch, parseHandshake, NativeHostManager };
