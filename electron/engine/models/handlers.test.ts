// @vitest-environment node
/**
 * The model-management handlers (ported from sidecar/tests/test_native_models.py): reply shapes, the repo overrides
 * threaded through, and the download running in the background with model_cancel stopping it.
 */
import '../test/env';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conn } from '../conn';
import { createState, handleMessage } from '../server';
import { downloadsOf, handlerSeams, register, restoreHandlerSeams } from './handlers';

class FakeSocket {
  readyState = 1;
  readonly sent: Array<Record<string, any>> = [];
  send(data: string | Uint8Array, cb?: (err?: Error) => void): void {
    if (typeof data === 'string') this.sent.push(JSON.parse(data));
    cb?.();
  }
}

const terminal = (socket: FakeSocket) => vi.waitFor(() => {
  if (!socket.sent.some((m) => m.type === 'model_download_done' || m.type === 'error')) throw new Error('still running');
});

const setup = () => {
  const state = createState();
  register(state);
  const socket = new FakeSocket();
  const conn = new Conn(socket);
  const call = (msg: Record<string, unknown>) => handleMessage(state, JSON.stringify(msg), null, conn);
  return { state, socket, conn, call };
};

afterEach(() => restoreHandlerSeams());

describe('model_status', () => {
  it('answers every asked model', async () => {
    handlerSeams.modelStatus = (m) => (m === 'sense-voice' ? 'ready' : 'absent');
    const [reply] = await setup().call({ type: 'model_status', id: 1, models: ['sense-voice', 'whisper-base'] });
    expect(reply).toEqual({ type: 'model_status_result', id: 1, statuses: { 'sense-voice': 'ready', 'whisper-base': 'absent' } });
  });

  it("applies the repos map, and no override for the rest", async () => {
    const calls: Array<[string, string | null | undefined]> = [];
    handlerSeams.modelStatus = (m, r) => { calls.push([m, r]); return 'ready'; };
    const [reply] = await setup().call({ type: 'model_status', id: 1, models: ['hy-mt2-1.8b', 'sense-voice'], repos: { 'hy-mt2-1.8b': 'tencent/Hy-MT2-1.8B-FP8' } });
    expect(calls).toEqual([['hy-mt2-1.8b', 'tencent/Hy-MT2-1.8B-FP8'], ['sense-voice', null]]);
    expect(reply?.statuses).toEqual({ 'hy-mt2-1.8b': 'ready', 'sense-voice': 'ready' });
  });
});

describe('model_delete', () => {
  it('answers with the bytes freed, the repo forwarded', async () => {
    const calls: Array<[string, string | null | undefined]> = [];
    handlerSeams.deleteModel = async (m, r) => { calls.push([m, r]); return 4096; };
    const { call } = setup();
    expect((await call({ type: 'model_delete', id: 7, model: 'whisper-base' }))[0]).toEqual({ type: 'model_delete_result', id: 7, model: 'whisper-base', freed: 4096 });
    expect((await call({ type: 'model_delete', id: 8, model: 'hy-mt2-7b', repo: 'tencent/Hy-MT2-7B-FP8' }))[0]).toEqual({ type: 'model_delete_result', id: 8, model: 'hy-mt2-7b', freed: 4096 });
    expect(calls).toEqual([['whisper-base', null], ['hy-mt2-7b', 'tencent/Hy-MT2-7B-FP8']]);
  });
});

describe('model_download', () => {
  it('runs in the background and pushes its completion', async () => {
    handlerSeams.downloadModel = async (model, send) => {
      await send({ type: 'model_progress', model, downloaded: 1, total: 1 });
      return 'ready';
    };
    const { state, socket, call } = setup();
    const [reply] = await call({ type: 'model_download', id: 1, model: 'm' });
    expect(reply).toBeNull();                                  // no synchronous answer
    await terminal(socket);
    expect(socket.sent).toContainEqual({ type: 'model_progress', model: 'm', downloaded: 1, total: 1 });
    expect(socket.sent.at(-1)).toEqual({ type: 'model_download_done', model: 'm', status: 'ready' });
    await vi.waitFor(() => expect(downloadsOf(state).has('m')).toBe(false));
  });

  it('model_cancel stops it, and its bookkeeping goes', async () => {
    handlerSeams.downloadModel = async (model, send, opts) => {
      for (;;) {
        if (opts?.signal?.aborted) return 'cancelled';
        await send({ type: 'model_progress', model, downloaded: 1, total: 9 });
        await new Promise((r) => setImmediate(r));
      }
    };
    const { state, socket, call } = setup();
    await call({ type: 'model_download', id: 1, model: 'm' });
    const { task } = downloadsOf(state).get('m')!;
    await new Promise((r) => setImmediate(r));
    expect((await call({ type: 'model_cancel', id: 2, model: 'm' }))[0]).toEqual({ type: 'ok', id: 2 });
    await task;
    expect(downloadsOf(state).has('m')).toBe(false);
    expect(socket.sent.some((m) => m.type === 'model_progress')).toBe(true);
    expect(socket.sent.at(-1)).toEqual({ type: 'model_download_done', model: 'm', status: 'cancelled' });
  });

  it('passes the chosen repo through', async () => {
    let seen: string | null | undefined;
    handlerSeams.downloadModel = async (_m, _s, opts) => { seen = opts?.repo; return 'ready'; };
    const { socket, call } = setup();
    await call({ type: 'model_download', id: 1, model: 'hy-mt2-7b', repo: 'tencent/Hy-MT2-7B-FP8' });
    await terminal(socket);
    expect(seen).toBe('tencent/Hy-MT2-7B-FP8');
  });

  it('a failure is an error tagged with the model', async () => {
    handlerSeams.downloadModel = async () => { throw new Error('no downloadable files for m'); };
    const { state, socket, call } = setup();
    await call({ type: 'model_download', id: 1, model: 'm' });
    await terminal(socket);
    expect(socket.sent.at(-1)).toEqual({ type: 'error', model: 'm', message: 'no downloadable files for m' });
    await vi.waitFor(() => expect(downloadsOf(state).has('m')).toBe(false));
  });

  it('a second download of the same model does not lose the first one\'s bookkeeping race', async () => {
    const releases: Array<() => void> = [];
    handlerSeams.downloadModel = () => new Promise((resolve) => releases.push(() => resolve('ready')));
    const { state, call } = setup();
    await call({ type: 'model_download', id: 1, model: 'm' });
    const first = downloadsOf(state).get('m')!;
    await call({ type: 'model_download', id: 2, model: 'm' });
    const second = downloadsOf(state).get('m')!;
    releases[0]();
    await first.task;
    expect(downloadsOf(state).get('m')).toBe(second);       // the first one's cleanup leaves the second's entry
    releases[1]();
    await second.task;
    expect(downloadsOf(state).has('m')).toBe(false);
  });

  it('without a connection it is an error', async () => {
    const state = createState();
    register(state);
    const [reply] = await handleMessage(state, JSON.stringify({ type: 'model_download', id: 3, model: 'm' }));
    expect(reply).toEqual({ type: 'error', id: 3, message: 'no connection' });
  });
});
