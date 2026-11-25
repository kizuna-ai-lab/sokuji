// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { guarded } from './deadline';
import { runEntry } from './entry';

class FakePort extends EventEmitter {
  posted: Array<Record<string, unknown>> = [];
  postMessage(m: Record<string, unknown>) { this.posted.push(m); }
  send(data: Record<string, unknown>) { this.emit('message', { data }); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('runEntry', () => {
  it('posts ready with the port and hands the engine its directory and origins', async () => {
    const port = new FakePort();
    const start = vi.fn(async () => ({ port: 4321, close: async () => {} }));
    await runEntry({ port, env: { SOKUJI_NATIVE_DIR: '/n', SOKUJI_ENGINE_ORIGINS: 'file://,http://localhost:5173' }, exit: () => {}, start });
    expect(port.posted).toContainEqual({ type: 'ready', port: 4321 });
    expect(start.mock.calls[0][0]).toMatchObject({ nativeDir: '/n', allowedOrigins: ['file://', 'http://localhost:5173'] });
  });

  it('never allows the null origin', async () => {
    const port = new FakePort();
    const start = vi.fn(async () => ({ port: 1, close: async () => {} }));
    await runEntry({ port, env: { SOKUJI_NATIVE_DIR: '/n', SOKUJI_ENGINE_ORIGINS: 'null,file://' }, exit: () => {}, start });
    expect(start.mock.calls[0][0].allowedOrigins).toEqual(['file://']);
  });

  it('posts failed with the loader message when the engine cannot start', async () => {
    const port = new FakePort();
    const start = async () => { throw new Error('/bad/sokuji_native_node.node: cannot open shared object file'); };
    await runEntry({ port, env: { SOKUJI_NATIVE_DIR: '/bad' }, exit: () => {}, start });
    expect(port.posted).toContainEqual({ type: 'failed', error: '/bad/sokuji_native_node.node: cannot open shared object file' });
  });

  it('fails without a native directory', async () => {
    const port = new FakePort();
    await runEntry({ port, env: {}, exit: () => {}, start: async () => ({ port: 1, close: async () => {} }) });
    expect(port.posted[0]).toMatchObject({ type: 'failed' });
  });

  it('answers ping with pong of the same seq', async () => {
    const port = new FakePort();
    await runEntry({ port, env: { SOKUJI_NATIVE_DIR: '/n' }, exit: () => {}, start: async () => ({ port: 1, close: async () => {} }) });
    port.send({ type: 'ping', seq: 7 });
    expect(port.posted).toContainEqual({ type: 'pong', seq: 7 });
  });

  it('on stop closes the engine, then exits 0', async () => {
    const port = new FakePort();
    const order: string[] = [];
    const exit = vi.fn((c: number) => { order.push(`exit${c}`); });
    await runEntry({ port, env: { SOKUJI_NATIVE_DIR: '/n' }, exit, start: async () => ({ port: 1, close: async () => { order.push('close'); } }) });
    port.send({ type: 'stop' });
    await flush();
    expect(order).toEqual(['close', 'exit0']);
  });

  it('a call past its deadline posts stuck', async () => {
    vi.useFakeTimers();
    try {
      const port = new FakePort();
      await runEntry({ port, env: { SOKUJI_NATIVE_DIR: '/n' }, exit: () => {}, start: async () => ({ port: 1, close: async () => {} }) });
      const p = guarded(new Promise(() => {}), 1000, 'asr_run').catch(() => {});
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(port.posted).toContainEqual({ type: 'stuck', job: 'asr_run' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards engine log lines to the host', async () => {
    const port = new FakePort();
    const start = async (o: { log: (l: string, m: string) => void }) => { o.log('warn', 'hello'); return { port: 1, close: async () => {} }; };
    await runEntry({ port, env: { SOKUJI_NATIVE_DIR: '/n' }, exit: () => {}, start });
    expect(port.posted).toContainEqual({ type: 'log', level: 'warn', message: 'hello' });
  });
});
