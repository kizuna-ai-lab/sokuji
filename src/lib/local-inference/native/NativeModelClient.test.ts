// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NativeModelClient } from './NativeModelClient';
import { FakeSidecarConnection } from './fakeSidecarConnection';

// download() awaits conn.connect() before it registers its handle and sends, so
// the register+send land a microtask later — flush before emitting to it.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('NativeModelClient', () => {
  it('status() sends model_status and returns the statuses map', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const p = c.status(['sense-voice'], { 'sense-voice': 'repo/x' });
    const sent = conn.sent[0];
    expect(sent).toMatchObject({ type: 'model_status', models: ['sense-voice'], repos: { 'sense-voice': 'repo/x' } });
    conn.emit({ type: 'model_status_result', id: sent.id, statuses: { 'sense-voice': 'ready' } });
    await expect(p).resolves.toEqual({ 'sense-voice': 'ready' });
  });

  it('download() streams progress then resolves on model_download_done (push-routed by model)', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const progress: number[] = [];
    const p = c.download('sense-voice', (pr) => progress.push(pr.downloaded));
    await tick();
    expect(conn.sent[0]).toMatchObject({ type: 'model_download', model: 'sense-voice' });
    conn.emit({ type: 'model_progress', model: 'sense-voice', downloaded: 50, total: 100 });
    conn.emit({ type: 'model_download_done', model: 'sense-voice', status: 'ready' });
    await expect(p).resolves.toBe('ready');
    expect(progress).toEqual([50]);
  });

  it('download() rejects when the sidecar errors with the model tag', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const p = c.download('sense-voice');
    await tick();
    conn.emit({ type: 'error', model: 'sense-voice', message: 'disk full' });
    await expect(p).rejects.toThrow('disk full');
  });

  it('a socket close rejects an in-flight download via onClose', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const p = c.download('sense-voice');
    await tick();
    conn.emitClose();
    await expect(p).rejects.toThrow('native host disconnected');
  });

  it('delete() returns freed bytes', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeModelClient(conn);
    const p = c.delete('sense-voice', 'repo/x');
    conn.emit({ type: 'model_delete_result', id: conn.sent[0].id, model: 'sense-voice', freed: 1234 });
    await expect(p).resolves.toBe(1234);
  });
});
