import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { EngineHost } from './engine-host.js';

class FakeChild extends EventEmitter {
  constructor() { super(); this.posted = []; this.killed = false; this.stdout = null; this.stderr = null; this.pid = 4242; }
  postMessage(m) { this.posted.push(m); }
  kill() { this.killed = true; queueMicrotask(() => this.emit('exit', 137)); return true; }
  say(m) { this.emit('message', m); }
}

function setup(over = {}) {
  const children = [];
  const fork = vi.fn(() => { const c = new FakeChild(); children.push(c); return c; });
  const log = vi.fn();
  const host = new EngineHost({ fork, enginePath: '/app/engine.js', env: { SOKUJI_NATIVE_DIR: '/n' }, log, ...over });
  return { host, children, fork, log };
}
const ready = async (host, children, port = 4000) => {
  const p = host.start();
  children[children.length - 1].say({ type: 'ready', port });
  return p;
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('EngineHost', () => {
  it('resolves the port from the ready message', async () => {
    const { host, children, fork } = setup();
    await expect(ready(host, children)).resolves.toEqual({ port: 4000 });
    expect(fork).toHaveBeenCalledWith('/app/engine.js', [], expect.objectContaining({ serviceName: 'Sokuji Engine', stdio: 'pipe', env: { SOKUJI_NATIVE_DIR: '/n' } }));
    expect(host.status()).toEqual({ running: true, port: 4000 });
  });

  it('a second start while running returns the same port without forking', async () => {
    const { host, children, fork } = setup();
    await ready(host, children);
    await expect(host.start()).resolves.toEqual({ port: 4000 });
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('two starts at once share one fork', async () => {
    const { host, children, fork } = setup();
    const a = host.start();
    const b = host.start();
    children[0].say({ type: 'ready', port: 5 });
    await expect(Promise.all([a, b])).resolves.toEqual([{ port: 5 }, { port: 5 }]);
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('rejects with the engine error on failed', async () => {
    const { host, children } = setup();
    const p = host.start();
    const caught = p.catch((e) => e.message);
    children[0].say({ type: 'failed', error: 'cannot open shared object file' });
    expect(await caught).toBe('cannot open shared object file');
    expect(host.status().running).toBe(false);
  });

  it('rejects if no ready arrives within 120 s', async () => {
    const { host, children } = setup();
    const caught = host.start().catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await caught).toMatch(/did not start within 120 s/);
    expect(children[0].killed).toBe(true);
  });

  it('an exit before ready rejects at once', async () => {
    const { host, children } = setup();
    const caught = host.start().catch((e) => e.message);
    children[0].emit('exit', 134);
    expect(await caught).toMatch(/exited.*134/);
  });

  it('after three crashes in 60 s, start refuses until restart', async () => {
    const { host, children } = setup();
    for (let i = 0; i < 3; i++) {
      await ready(host, children, 4000 + i);
      children[i].emit('exit', 134);
      await vi.advanceTimersByTimeAsync(10_000);
    }
    await expect(host.start()).rejects.toThrow(/stopped unexpectedly three times/);
    expect(children).toHaveLength(3);
  });

  it('crashes older than 60 s do not count', async () => {
    const { host, children } = setup();
    for (let i = 0; i < 3; i++) {
      await ready(host, children, 4000 + i);
      children[i].emit('exit', 134);
      await vi.advanceTimersByTimeAsync(40_000);
    }
    await expect(ready(host, children)).resolves.toEqual({ port: 4000 });
  });

  it('after an exit the next start forks afresh', async () => {
    const { host, children, fork } = setup();
    await ready(host, children, 1);
    children[0].emit('exit', 134);
    expect(host.status()).toEqual({ running: false, port: null });
    await ready(host, children, 2);
    expect(fork).toHaveBeenCalledTimes(2);
  });

  it('kills the engine when a ping goes unanswered for 15 s', async () => {
    const { host, children } = setup();
    await ready(host, children);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(children[0].posted.some((m) => m.type === 'ping')).toBe(true);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(children[0].killed).toBe(true);
  });

  it('a pong keeps it alive', async () => {
    const { host, children } = setup();
    await ready(host, children);
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      const ping = children[0].posted.filter((m) => m.type === 'ping').pop();
      children[0].say({ type: 'pong', seq: ping.seq });
    }
    expect(children[0].killed).toBe(false);
  });

  it('kills and forgets the engine on stuck', async () => {
    const { host, children } = setup();
    await ready(host, children);
    children[0].say({ type: 'stuck', job: 'asr_run' });
    expect(children[0].killed).toBe(true);
    expect(host.status()).toEqual({ running: false, port: null });
  });

  it('an engine that dies before ready counts toward the crash budget', async () => {
    const { host, children } = setup();
    for (let i = 0; i < 3; i++) {
      const p = host.start().catch(() => {});
      children[i].emit('exit', 134);
      await p;
    }
    await expect(host.start()).rejects.toThrow(/stopped unexpectedly three times/);
    expect(children).toHaveLength(3);
  });

  it('a utility-process error event is logged and does not throw', async () => {
    const { host, children, log } = setup();
    await ready(host, children);
    expect(() => children[0].emit('error', 'FatalError', 'oom')).not.toThrow();
    expect(log).toHaveBeenCalledWith('error', expect.stringMatching(/FatalError/));
  });

  it('three hangs in 60 s count like three crashes', async () => {
    const { host, children } = setup();
    for (let i = 0; i < 3; i++) {
      await ready(host, children, 4000 + i);
      children[i].say({ type: 'stuck', job: 'asr_run' });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await expect(host.start()).rejects.toThrow(/stopped unexpectedly three times/);
  });

  it('once the crash limit is hit, start refuses for good, not only for a minute', async () => {
    const { host, children } = setup();
    for (let i = 0; i < 3; i++) {
      await ready(host, children, 4000 + i);
      children[i].emit('exit', 134);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await expect(host.start()).rejects.toThrow(/stopped unexpectedly three times/);
    expect(children).toHaveLength(3);
  });

  it('a start after a hung engine was killed waits for it to exit, so two engines never run at once', async () => {
    const { host, children, fork } = setup();
    await ready(host, children);
    children[0].kill = function () { this.killed = true; return true; };      // the process is slow to die
    children[0].say({ type: 'stuck', job: 'asr_run' });
    const second = host.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fork).toHaveBeenCalledTimes(1);                                     // still waiting for the first to exit
    children[0].emit('exit', 137);
    await vi.advanceTimersByTimeAsync(0);
    expect(fork).toHaveBeenCalledTimes(2);
    children[1].say({ type: 'ready', port: 9 });
    await expect(second).resolves.toEqual({ port: 9 });
  });

  it('when the dying engine has not exited after 5 s, start fails and does not fork a second one', async () => {
    const { host, children, fork } = setup();
    await ready(host, children);
    children[0].kill = function () { this.killed = true; return true; };      // never exits
    children[0].say({ type: 'stuck', job: 'asr_run' });
    const first = host.start().catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await first).toMatch(/still shutting down/);
    expect(fork).toHaveBeenCalledTimes(1);
    const again = host.start().catch((e) => e.message);                         // the barrier stays while it lives
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await again).toMatch(/still shutting down/);
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('a stop while a start waits for the old engine cancels that start', async () => {
    const { host, children, fork } = setup();
    await ready(host, children);
    children[0].kill = function () { this.killed = true; return true; };
    children[0].say({ type: 'stuck', job: 'asr_run' });
    const waiting = host.start().catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(100);
    await host.stop();
    children[0].emit('exit', 137);
    await vi.advanceTimersByTimeAsync(0);
    expect(await waiting).toMatch(/cancelled/);
    expect(fork).toHaveBeenCalledTimes(1);                                     // nothing was quietly started after the stop
  });

  it('a ready that arrives after kill() does not make the start succeed', async () => {
    const { host, children } = setup();
    const starting = host.start().catch((e) => e.message);
    host.kill();
    children[0].say({ type: 'ready', port: 4000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await starting).toMatch(/exited before it was ready|cancelled/);
    expect(host.status()).toEqual({ running: false, port: null });
  });

  it('a kill that came before the process had spawned is repeated when it spawns', async () => {
    const { host, children } = setup();
    const starting = host.start().catch(() => {});
    const kill = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);       // Electron: false while there is no pid yet
    children[0].kill = kill;
    host.kill();
    expect(kill).toHaveBeenCalledTimes(1);
    children[0].emit('spawn');
    expect(kill).toHaveBeenCalledTimes(2);
    children[0].emit('exit', 137);
    await starting;
  });

  it('a second stuck from a child already dropped does not use another crash slot', async () => {
    const { host, children, fork } = setup();
    await ready(host, children, 1);
    children[0].kill = function () { this.killed = true; return true; };         // slow to exit
    children[0].say({ type: 'stuck', job: 'a' });
    children[0].say({ type: 'stuck', job: 'b' });
    children[0].emit('exit', 137);
    await ready(host, children, 2);
    children[1].emit('exit', 134);                                               // the second real failure
    await ready(host, children, 3);                                              // must still be allowed
    expect(fork).toHaveBeenCalledTimes(3);
  });

  it('a launch that never got a process (no pid) does not count as a crash', async () => {
    const { host, children } = setup();
    for (let i = 0; i < 3; i++) {
      const p = host.start().catch(() => {});
      children[i].pid = undefined;
      children[i].emit('exit', 1);
      await p;
    }
    await expect(ready(host, children, 77)).resolves.toEqual({ port: 77 });
  });

  it('stop() withdraws the port at once; a start waits for the old engine and then forks', async () => {
    const { host, children, fork } = setup();
    await ready(host, children, 4000);
    const stopping = host.stop();
    expect(host.status()).toEqual({ running: false, port: null });
    const next = host.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(fork).toHaveBeenCalledTimes(1);                                       // not handed the dying engine's port
    children[0].emit('exit', 0);
    await stopping;
    await vi.advanceTimersByTimeAsync(0);
    children[1].say({ type: 'ready', port: 4001 });
    await expect(next).resolves.toEqual({ port: 4001 });
  });

  it('kill() ends the engine at once, for the quit paths that cannot wait', async () => {
    const { host, children } = setup();
    await ready(host, children);
    host.kill();
    expect(children[0].killed).toBe(true);
    expect(host.status()).toEqual({ running: false, port: null });
  });

  it('stop posts stop and kills after 2 s', async () => {
    const { host, children } = setup();
    await ready(host, children);
    const stopped = host.stop();
    expect(children[0].posted).toContainEqual({ type: 'stop' });
    expect(children[0].killed).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await stopped;
    expect(children[0].killed).toBe(true);
  });

  it('stop returns at once when the engine exits on its own', async () => {
    const { host, children } = setup();
    await ready(host, children);
    const stopped = host.stop();
    children[0].emit('exit', 0);
    await stopped;
    expect(children[0].killed).toBe(false);
  });

  it('an exit after stop is not a crash', async () => {
    const { host, children } = setup();
    for (let i = 0; i < 4; i++) {
      await ready(host, children, 10 + i);
      const stopped = host.stop();
      children[i].emit('exit', 0);
      await stopped;
    }
    expect(children).toHaveLength(4);
  });

  it('forwards log messages to the app log', async () => {
    const { host, children, log } = setup();
    const p = host.start();
    children[0].say({ type: 'log', level: 'warn', message: 'hello' });
    children[0].say({ type: 'ready', port: 1 });
    await p;
    expect(log).toHaveBeenCalledWith('warn', '[engine] hello');
  });

  it('registers the IPC handlers with the old reply shapes', async () => {
    const { host, children } = setup();
    const handlers = {};
    host.registerIpc({ handle: (ch, fn) => { handlers[ch] = fn; } });
    expect(Object.keys(handlers).sort()).toEqual(['native-host:start', 'native-host:status', 'native-host:stop']);
    const p = handlers['native-host:start']();
    children[0].say({ type: 'ready', port: 77 });
    await expect(p).resolves.toEqual({ ok: true, port: 77 });
    expect(handlers['native-host:status']()).toEqual({ ok: true, running: true, port: 77 });
    const stopped = handlers['native-host:stop']();
    children[0].emit('exit', 0);
    await expect(stopped).resolves.toEqual({ ok: true });
    const failing = handlers['native-host:start']();
    children[1].say({ type: 'failed', error: 'boom' });
    await expect(failing).resolves.toEqual({ ok: false, error: 'boom' });
  });
});
