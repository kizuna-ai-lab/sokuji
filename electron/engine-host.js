/**
 * Runs the Node engine (dist-electron/engine.js) in an Electron utilityProcess and keeps it honest.
 *
 * start()   forks it and resolves { port } from its `ready` message; a `failed` message, an exit before ready, or no
 *           ready within 30 s rejects. A running engine answers again with the same port.
 * watchdog  pings every 5 s; no pong for 15 s, or a `stuck` message (a native call missed its deadline), kills it. The
 *           renderer's next connect() calls start() and gets a fresh one.
 * crashes   three unexpected exits within 60 s and start() refuses until the app restarts.
 * stop()    asks it to stop, kills it after 2 s.
 * The IPC reply shapes are the ones the Python host had: { ok: true, port } / { ok: false, error }.
 */
const START_TIMEOUT_MS = 30_000;
const PING_EVERY_MS = 5_000;
const PONG_WITHIN_MS = 15_000;
const STOP_GRACE_MS = 2_000;
const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;

function defaultFork(modulePath, args, options) {
  const { utilityProcess } = require('electron');
  return utilityProcess.fork(modulePath, args, options);
}

class EngineHost {
  constructor({ fork = defaultFork, enginePath, env = process.env, log = () => {}, now = () => Date.now() } = {}) {
    this.fork = fork;
    this.enginePath = enginePath;
    this.env = env;
    this.log = log;
    this.now = now;
    this.child = null;
    this.port = null;
    this.starting = null;
    this.crashes = [];
    this.exitWaiters = [];
  }

  status() {
    return { running: this.child !== null && this.port !== null, port: this.port };
  }

  start() {
    if (this.child && this.port !== null) return Promise.resolve({ port: this.port });
    if (this.starting) return this.starting;
    const t = this.now();
    this.crashes = this.crashes.filter((c) => t - c < CRASH_WINDOW_MS);
    if (this.crashes.length >= CRASH_LIMIT) {
      return Promise.reject(new Error('The local engine stopped unexpectedly three times in a minute. Restart Sokuji to try again.'));
    }
    this.starting = this.launch().finally(() => { this.starting = null; });
    return this.starting;
  }

  launch() {
    return new Promise((resolve, reject) => {
      const child = this.fork(this.enginePath, [], { serviceName: 'Sokuji Engine', stdio: 'pipe', env: this.env });
      this.child = child;
      this.port = null;
      let settled = false;
      let stopping = false;
      let pingTimer = null;
      let startTimer = null;
      let lastPong = this.now();
      let seq = 0;

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        fn(value);
      };
      const forget = () => {
        clearInterval(pingTimer);
        if (this.child === child) { this.child = null; this.port = null; }
      };

      startTimer = setTimeout(() => {
        settle(reject, new Error('The local engine did not start within 30 s'));
        try { child.kill(); } catch { /* already gone */ }
      }, START_TIMEOUT_MS);

      for (const stream of [child.stdout, child.stderr]) {
        stream?.on?.('data', (d) => this.log('info', `[engine] ${String(d).trimEnd()}`));
      }

      child.on('message', (m) => {
        if (!m || typeof m !== 'object') return;
        switch (m.type) {
          case 'ready':
            if (settled) return;
            this.port = m.port;
            lastPong = this.now();
            pingTimer = setInterval(() => {
              if (this.now() - lastPong > PONG_WITHIN_MS) {
                this.log('error', '[engine] no answer to ping for 15 s; killing it');
                this.crashes.push(this.now());
                forget();
                try { child.kill(); } catch { /* already gone */ }
                return;
              }
              child.postMessage({ type: 'ping', seq: ++seq });
            }, PING_EVERY_MS);
            settle(resolve, { port: m.port });
            break;
          case 'failed':
            settle(reject, new Error(String(m.error)));
            forget();
            try { child.kill(); } catch { /* already gone */ }
            break;
          case 'pong':
            lastPong = this.now();
            break;
          case 'stuck':
            this.log('error', `[engine] ${m.job} missed its deadline; killing the engine`);
            this.crashes.push(this.now());
            forget();
            try { child.kill(); } catch { /* already gone */ }
            break;
          case 'log':
            this.log(m.level, `[engine] ${m.message}`);
            break;
          default:
        }
      });

      // A fatal V8/OS error in the process is reported here before it exits; without a listener the event throws.
      child.on('error', (type, location) => this.log('error', `[engine] fatal error ${type} ${location ?? ''}`.trim()));

      child.on('exit', (code) => {
        const wasCurrent = this.child === child;
        forget();
        if (!settled) {
          if (!stopping && !child.__stopRequested) this.crashes.push(this.now());   // a bad driver that aborts at load counts too
          settle(reject, new Error(`The local engine exited before it was ready (code ${code})`));
        } else if (wasCurrent && !stopping && !child.__stopRequested) this.crashes.push(this.now());
        if (child.__stopRequested) child.__stopRequested = false;
        for (const w of this.exitWaiters.splice(0)) w();
      });

      child.__markStopping = () => { stopping = true; child.__stopRequested = true; };
    });
  }

  stop() {
    const child = this.child;
    if (!child) return Promise.resolve();
    child.__markStopping?.();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      this.exitWaiters.push(finish);
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already gone */ }
        // kill() reports through 'exit'; do not wait forever for it
        setTimeout(finish, 500);
      }, STOP_GRACE_MS);
      try { child.postMessage({ type: 'stop' }); } catch { try { child.kill(); } catch { /* gone */ } }
    });
  }

  registerIpc(ipcMain) {
    ipcMain.handle('native-host:start', async () => {
      try { return { ok: true, ...(await this.start()) }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
    ipcMain.handle('native-host:stop', async () => { await this.stop(); return { ok: true }; });
    ipcMain.handle('native-host:status', () => ({ ok: true, ...this.status() }));
  }
}

module.exports = { EngineHost };
