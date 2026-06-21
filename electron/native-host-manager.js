const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

function resolvePython() {
  if (process.env.SOKUJI_SIDECAR_PYTHON) return process.env.SOKUJI_SIDECAR_PYTHON;
  const venv = path.join(__dirname, '..', 'sidecar', '.venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
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
      const { app } = require('electron');
      // Respect a pre-set HF_HOME (e.g. populated by sidecar/setup.sh) so manual
      // testing reuses the same model cache; otherwise isolate under userData.
      const hfHome = process.env.HF_HOME || path.join(app.getPath('userData'), 'hf-cache');
      const env = { ...process.env, HF_HOME: hfHome };
      const child = spawn(resolvePython(), ['-m', 'sokuji_sidecar'], {
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
      setTimeout(() => { if (!this.port) reject(new Error('native-host handshake timeout')); }, 30000);
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

module.exports = { resolvePython, parseHandshake, NativeHostManager };
