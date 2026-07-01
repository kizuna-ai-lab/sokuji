const path = require('path');
const fs = require('fs');

function resolvePython() {
  if (process.env.SOKUJI_SIDECAR_PYTHON) return process.env.SOKUJI_SIDECAR_PYTHON;
  const venv = path.join(__dirname, '..', 'sidecar', '.venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

// torch's bundled CUDA/cuDNN lib dirs inside a venv (`lib/python*/site-packages/nvidia/*/lib`).
function nvidiaLibDirs(venvRoot) {
  const dirs = [];
  try {
    const libRoot = path.join(venvRoot, 'lib');
    for (const py of fs.readdirSync(libRoot)) {                 // e.g. python3.10
      const nvidia = path.join(libRoot, py, 'site-packages', 'nvidia');
      let pkgs;
      try { pkgs = fs.readdirSync(nvidia); } catch { continue; }
      for (const pkg of pkgs) {                                 // cudnn, cublas, ...
        const d = path.join(nvidia, pkg, 'lib');
        try { if (fs.statSync(d).isDirectory()) dirs.push(d); } catch { /* skip */ }
      }
    }
  } catch { /* no venv layout → skip */ }
  return dirs;
}

// Linux: onnxruntime-gpu resolves cuDNN/cuBLAS from the system by default, which can
// mismatch the torch-bundled cuDNN already resident in the sidecar process (undefined
// symbol → CUDAExecutionProvider fails → silent CPU fallback). Prepend torch's bundled
// nvidia/*/lib dirs so the whole process uses one consistent CUDA/cuDNN set. (The
// sidecar also preloads cuDNN in-process; this is the loader-level belt-and-suspenders.)
function withTorchCudaLibs(env, venvRoot, platform) {
  if (platform !== 'linux') return env;
  const dirs = nvidiaLibDirs(venvRoot);
  if (dirs.length === 0) return env;
  const existing = env.LD_LIBRARY_PATH ? [env.LD_LIBRARY_PATH] : [];
  return { ...env, LD_LIBRARY_PATH: [...dirs, ...existing].join(':') };
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
      const pythonPath = resolvePython();
      const venvRoot = path.dirname(path.dirname(pythonPath));   // <venv>/bin/python → <venv>
      const env = withTorchCudaLibs({ ...process.env, HF_HOME: hfHome }, venvRoot, process.platform);
      const child = spawn(pythonPath, ['-m', 'sokuji_sidecar'], {
        cwd: path.join(__dirname, '..', 'sidecar'), env,
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

module.exports = { resolvePython, parseHandshake, nvidiaLibDirs, withTorchCudaLibs, NativeHostManager };
