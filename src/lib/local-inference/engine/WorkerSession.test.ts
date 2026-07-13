import { describe, it, expect, vi } from 'vitest';
import { WorkerSession } from './WorkerSession';
import { MockWorker } from './testing/mockWorker';

function makeSession(over: Partial<{
  onMessage: (m: any) => void; revokeBlobs: () => void; onFatalError: (m: string) => void;
}> = {}) {
  const worker = new MockWorker('x');
  const session = new WorkerSession({
    makeWorker: () => worker as unknown as Worker,
    onMessage: over.onMessage ?? vi.fn(),
    revokeBlobs: over.revokeBlobs,
    onFatalError: over.onFatalError,
  });
  return { worker, session };
}

describe('WorkerSession', () => {
  it('creates the worker synchronously in the constructor', () => {
    const worker = new MockWorker('x');
    const makeWorker = vi.fn(() => worker as unknown as Worker);
    new WorkerSession({ makeWorker, onMessage: vi.fn() });
    expect(makeWorker).toHaveBeenCalledTimes(1);
  });

  it('start() posts the init message and resolves on ready, revoking once', async () => {
    const revokeBlobs = vi.fn();
    const { worker, session } = makeSession({ revokeBlobs });
    const p = session.start({ type: 'init', fileUrls: {} });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'init', fileUrls: {} });
    expect(session.ready).toBe(false);
    worker.emit({ type: 'ready', loadTimeMs: 42 });
    await expect(p).resolves.toEqual({ type: 'ready', loadTimeMs: 42 });
    expect(session.ready).toBe(true);
    expect(revokeBlobs).toHaveBeenCalledTimes(1);
  });

  it('rejects and revokes once on a pre-ready error message (and fires onFatalError)', async () => {
    const revokeBlobs = vi.fn();
    const onFatalError = vi.fn();
    const { worker, session } = makeSession({ revokeBlobs, onFatalError });
    const p = session.start({ type: 'init' });
    worker.emit({ type: 'error', error: 'load failed' });
    await expect(p).rejects.toThrow('load failed');
    expect(onFatalError).toHaveBeenCalledWith('load failed');
    expect(revokeBlobs).toHaveBeenCalledTimes(1);
    expect(session.ready).toBe(false);
  });

  it('rejects and revokes once on a pre-ready worker onerror', async () => {
    const revokeBlobs = vi.fn();
    const onFatalError = vi.fn();
    const { worker, session } = makeSession({ revokeBlobs, onFatalError });
    const p = session.start({ type: 'init' });
    worker.emitError('worker crashed');
    await expect(p).rejects.toThrow('worker crashed');
    expect(onFatalError).toHaveBeenCalledWith('worker crashed');
    expect(revokeBlobs).toHaveBeenCalledTimes(1);
  });

  it('routes non-handshake messages to onMessage (including post-ready errors), no re-revoke', async () => {
    const onMessage = vi.fn();
    const revokeBlobs = vi.fn();
    const onFatalError = vi.fn();
    const { worker, session } = makeSession({ onMessage, revokeBlobs, onFatalError });
    const p = session.start({ type: 'init' });
    worker.emit({ type: 'status', message: 'loading' });   // pre-ready status → routed
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await p;
    worker.emit({ type: 'result', text: 'hi' });           // post-ready → routed
    worker.emit({ type: 'error', id: 'r1', error: 'req failed' }); // post-ready error → routed
    expect(onMessage).toHaveBeenCalledWith({ type: 'status', message: 'loading' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'result', text: 'hi' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'error', id: 'r1', error: 'req failed' });
    expect(revokeBlobs).toHaveBeenCalledTimes(1); // only the ready settle revoked
    expect(onFatalError).not.toHaveBeenCalled(); // post-ready 'error' messages route to onMessage, not onFatalError
  });

  it('post-ready onerror fires onFatalError but does not reject/re-revoke', async () => {
    const onFatalError = vi.fn();
    const revokeBlobs = vi.fn();
    const { worker, session } = makeSession({ onFatalError, revokeBlobs });
    const p = session.start({ type: 'init' });
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await p;
    worker.emitError('late error');
    expect(onFatalError).toHaveBeenCalledWith('late error');
    expect(revokeBlobs).toHaveBeenCalledTimes(1);
  });

  it('post() forwards a message, with transfer list when provided', () => {
    const { worker, session } = makeSession();
    const buf = new ArrayBuffer(8);
    session.post({ type: 'audio', samples: 1 }, [buf]);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'audio', samples: 1 }, [buf]);
    session.post({ type: 'flush' });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'flush' });
  });

  it('addMessageListener() registers a raw message listener and returns a remover', () => {
    const { worker, session } = makeSession();
    const handler = vi.fn();
    const remove = session.addMessageListener(handler);
    expect(worker.addEventListener).toHaveBeenCalledWith('message', handler);
    expect(worker.removeEventListener).not.toHaveBeenCalled();
    remove();
    expect(worker.removeEventListener).toHaveBeenCalledWith('message', handler);
  });

  it('dispose() posts dispose, terminates, and clears ready', async () => {
    const { worker, session } = makeSession();
    const p = session.start({ type: 'init' });
    worker.emit({ type: 'ready', loadTimeMs: 1 });
    await p;
    session.dispose();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'dispose' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(session.ready).toBe(false);
  });
});
