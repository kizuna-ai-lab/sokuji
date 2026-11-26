/**
 * Runs the Node engine (dist-electron/engine.js) in an Electron utilityProcess and keeps it honest.
 *
 * start()   forks it and resolves { port } from its `ready` message; a `failed` message, an exit before ready, or no
 *           ready within 120 s rejects. A running engine answers again with the same port.
 * watchdog  pings every 5 s; no pong for 15 s, or a `stuck` message (a native call missed its deadline), kills it. The
 *           renderer's next connect() calls start() and gets a fresh one.
 * crashes   three unexpected exits within 60 s and start() refuses until the app restarts.
 * stop()    asks it to stop, kills it after 2 s.
 * The IPC reply shapes are the ones the Python host had: { ok: true, port } / { ok: false, error }.
 */
// Generous: before it says ready the engine initialises the native library, and on a Mac the first run compiles the Metal
// shaders (about 15 s measured on an M4 with a cold cache, longer on older machines).
const START_TIMEOUT_MS = 120_000;
const PING_EVERY_MS = 5_000;
const PONG_WITHIN_MS = 15_000;
const STOP_GRACE_MS = 2_000;
const EXIT_WAIT_MS = 5_000;
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
    this.tripped = false;   // the crash limit was hit: stays until the app restarts
    this.dying = null;      // a child that was told to die and may not have exited yet
    this.epoch = 0;         // bumped by stop()/kill(): a start that began before it is cancelled
  }

  status() {
    return { running: this.child !== null && this.port !== null, port: this.port };
  }

  start() {
    if (this.child && this.port !== null) return Promise.resolve({ port: this.port });
    if (this.starting) return this.starting;
    if (this.tripped) {
      return Promise.reject(new Error('The local engine stopped unexpectedly three times in a minute. Restart Sokuji to try again.'));
    }
    this.starting = this.launch().finally(() => { this.starting = null; });
    return this.starting;
  }

  /** Counts one unexpected end of the engine; the third within a minute stops further starts until the app restarts. */
  recordCrash() {
    const t = this.now();
    this.crashes.push(t);
    this.crashes = this.crashes.filter((c) => t - c < CRASH_WINDOW_MS);
    if (this.crashes.length >= CRASH_LIMIT) this.tripped = true;
  }

  /** Tells a child to die and remembers it, so the next start does not fork beside a process that is still dying. */
  killChild(child) {
    this.dying = child;
    try { child.kill(); } catch { /* already gone */ }
  }

  async launch() {
    const epoch = this.epoch;
    const prev = this.dying;
    if (prev && !prev.__done) {
      await Promise.race([prev.__exit, new Promise((r) => setTimeout(r, EXIT_WAIT_MS))]);
      // Still alive after the wait: do not fork beside it. The barrier stays until it exits.
      if (!prev.__done) throw new Error('The previous local engine is still shutting down; try again in a moment');
    }
    if (epoch !== this.epoch) throw new Error('The local engine start was cancelled');
    return new Promise((resolve, reject) => {
      const child = this.fork(this.enginePath, [], { serviceName: 'Sokuji Engine', stdio: 'pipe', env: this.env });
      this.child = child;
      this.port = null;
      child.__exit = new Promise((r) => child.on('exit', r));
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
        settle(reject, new Error('The local engine did not start within 120 s'));
        this.killChild(child);
      }, START_TIMEOUT_MS);

      for (const stream of [child.stdout, child.stderr]) {
        stream?.on?.('data', (d) => this.log('info', `[engine] ${String(d).trimEnd()}`));
      }

      child.on('message', (m) => {
        if (!m || typeof m !== 'object') return;
        switch (m.type) {
          case 'ready':
            if (settled || this.child !== child || stopping) return;   // stopped or killed meanwhile: not a start
            this.port = m.port;
            lastPong = this.now();
            pingTimer = setInterval(() => {
              if (this.child !== child) { clearInterval(pingTimer); return; }   // stopped or killed meanwhile
              if (this.now() - lastPong > PONG_WITHIN_MS) {
                this.log('error', '[engine] no answer to ping for 15 s; killing it');
                this.recordCrash();
                forget();
                this.killChild(child);
                return;
              }
              child.postMessage({ type: 'ping', seq: ++seq });
            }, PING_EVERY_MS);
            settle(resolve, { port: m.port });
            break;
          case 'failed':
            settle(reject, new Error(String(m.error)));
            forget();
            this.killChild(child);
            break;
          case 'pong':
            lastPong = this.now();
            break;
          case 'stuck':
            this.log('error', `[engine] ${m.job} missed its deadline; killing the engine`);
            this.recordCrash();
            forget();
            this.killChild(child);
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
        child.__done = true;
        forget();
        if (!settled) {
          if (!stopping && !child.__stopRequested) this.recordCrash();   // a bad driver that aborts at load counts too
          settle(reject, new Error(`The local engine exited before it was ready (code ${code})`));
        } else if (wasCurrent && !stopping && !child.__stopRequested) this.recordCrash();
        if (child.__stopRequested) child.__stopRequested = false;
        for (const w of (child.__exitWaiters ?? []).splice(0)) w();   // only the waiters of this child
      });

      child.__markStopping = () => { stopping = true; child.__stopRequested = true; };
    });
  }

  /** Ends the engine at once. For the quit paths, which exit the app and cannot wait for a graceful stop. */
  kill() {
    this.epoch += 1;
    const child = this.child;
    if (!child) return;
    child.__markStopping?.();
    this.child = null;
    this.port = null;
    this.killChild(child);
  }

  stop() {
    this.epoch += 1;
    const child = this.child;
    if (!child) return Promise.resolve();
    child.__markStopping?.();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      (child.__exitWaiters ??= []).push(finish);
      const timer = setTimeout(() => {
        this.killChild(child);
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
