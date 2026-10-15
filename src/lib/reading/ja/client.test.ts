import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FromLinderaWorker, ToLinderaWorker } from './protocol';

class FakeWorker {
  static last: FakeWorker;
  sent: { msg: ToLinderaWorker; transfer?: Transferable[] }[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<FromLinderaWorker>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() { FakeWorker.last = this; }
  postMessage(msg: ToLinderaWorker, transfer?: Transferable[]) { this.sent.push({ msg, transfer }); }
  terminate() { this.terminated = true; }
  answer(data: FromLinderaWorker) { this.onmessage?.({ data } as MessageEvent<FromLinderaWorker>); }
}

vi.mock('./createLinderaWorker', () => ({ createLinderaWorker: () => new FakeWorker() }));

const { startJaClient } = await import('./client');

describe('startJaClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('transfers the wasm, resolves on ready, and answers tokenize by id', async () => {
    const wasm = new ArrayBuffer(8);
    const started = startJaClient(wasm);
    const worker = FakeWorker.last;
    expect(worker.sent[0].msg).toEqual({ type: 'init', wasm });
    expect(worker.sent[0].transfer).toEqual([wasm]);
    worker.answer({ type: 'ready' });
    const client = await started;

    const a = client.tokenize('一');
    const b = client.tokenize('二');
    const [first, second] = worker.sent.slice(1).map((s) => s.msg) as Extract<ToLinderaWorker, { type: 'tokenize' }>[];
    worker.answer({ type: 'tokens', id: second.id, tokens: [{ surface: '二', reading: 'ニ', unknown: false }] });
    worker.answer({ type: 'tokens', id: first.id, tokens: [{ surface: '一', reading: 'イチ', unknown: false }] });
    expect(await a).toEqual([{ surface: '一', reading: 'イチ', unknown: false }]);
    expect(await b).toEqual([{ surface: '二', reading: 'ニ', unknown: false }]);
  });

  it('rejects and terminates when the worker cannot start', async () => {
    const started = startJaClient(new ArrayBuffer(8));
    const worker = FakeWorker.last;
    worker.answer({ type: 'failed', message: 'CompileError' });
    await expect(started).rejects.toThrow('CompileError');
    expect(worker.terminated).toBe(true);
  });

  it('resolves pending requests with null on terminate', async () => {
    const started = startJaClient(new ArrayBuffer(8));
    FakeWorker.last.answer({ type: 'ready' });
    const client = await started;
    const pending = client.tokenize('三');
    client.terminate();
    expect(await pending).toBeNull();
    expect(FakeWorker.last.terminated).toBe(true);
  });

  it('resolves tokenize with null after terminate', async () => {
    const started = startJaClient(new ArrayBuffer(8));
    const worker = FakeWorker.last;
    worker.answer({ type: 'ready' });
    const client = await started;
    client.terminate();
    const sentBefore = worker.sent.length;
    expect(await client.tokenize('x')).toBeNull();
    expect(worker.sent.length).toBe(sentBefore);
  });

  it('settles pending requests and later ones with null when the worker errors after ready, and says so', async () => {
    const onGone = vi.fn();
    const started = startJaClient(new ArrayBuffer(8), onGone);
    const worker = FakeWorker.last;
    worker.answer({ type: 'ready' });
    const client = await started;
    const pending = client.tokenize('y');
    worker.onerror?.({ message: 'boom' } as ErrorEvent);
    expect(await pending).toBeNull();
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(onGone.mock.calls[0][0]).toMatchObject({ message: 'boom' });
    const sentBefore = worker.sent.length;
    expect(await client.tokenize('z')).toBeNull();
    expect(worker.sent.length).toBe(sentBefore);
  });

  it('rejects, without calling onGone, when the worker errors before ready', async () => {
    const onGone = vi.fn();
    const started = startJaClient(new ArrayBuffer(8), onGone);
    FakeWorker.last.onerror?.({ message: 'out of memory' } as ErrorEvent);
    await expect(started).rejects.toThrow('out of memory');
    expect(onGone).not.toHaveBeenCalled();
  });

  it('does not call onGone for its own terminate', async () => {
    const onGone = vi.fn();
    const started = startJaClient(new ArrayBuffer(8), onGone);
    FakeWorker.last.answer({ type: 'ready' });
    (await started).terminate();
    expect(onGone).not.toHaveBeenCalled();
  });
});
