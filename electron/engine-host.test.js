import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { EngineHost } from './engine-host.js';

class FakeChild extends EventEmitter {
  constructor() { super(); this.posted = []; this.killed = false; this.stdout = null; this.stderr = null; }
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

  it('rejects if no ready arrives within 30 s', async () => {
    const { host, children } = setup();
    const caught = host.start().catch((e) => e.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await caught).toMatch(/did not start within 30 s/);
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

  it('three hangs in 60 s count like three crashes', async () => {
    const { host, children } = setup();
    for (let i = 0; i < 3; i++) {
      await ready(host, children, 4000 + i);
      children[i].say({ type: 'stuck', job: 'asr_run' });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await expect(host.start()).rejects.toThrow(/stopped unexpectedly three times/);
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
