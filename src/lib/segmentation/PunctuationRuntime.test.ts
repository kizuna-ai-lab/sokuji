import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { PunctuationRuntime, modelForLanguage, MODEL_IDS } from './PunctuationRuntime';
import { MockWorker } from '../local-inference/engine/testing/mockWorker';
import { ModelManager } from '../local-inference/ModelManager';
import { checkWebGPU } from '../../utils/webgpu';
import { createPunctuationWorker } from './createPunctuationWorker';

vi.mock('./createPunctuationWorker', () => ({
  createPunctuationWorker: vi.fn(),
}));
vi.mock('../../utils/webgpu', () => ({
  checkWebGPU: vi.fn(),
}));

describe('modelForLanguage', () => {
  it.each([
    ['zh', 'fireredpunc'],
    ['zh-CN', 'fireredpunc'],
    ['cmn-CN', 'fireredpunc'],
    ['yue', 'fireredpunc'],
    ['cantonese', 'fireredpunc'],
    ['en', 'edge-punct-en'],
    ['en-US', 'edge-punct-en'],
    ['ja', 'sat-3l-sm'],
    ['ko', 'sat-3l-sm'],
    ['ru', 'sat-3l-sm'],
    ['auto', 'sat-3l-sm'],
    ['', 'sat-3l-sm'],
  ])('%s -> %s', (lang, model) => {
    expect(modelForLanguage(lang)).toBe(model);
  });
});

function setDeviceMemory(gb: number | undefined): void {
  if (gb === undefined) {
    delete (navigator as { deviceMemory?: number }).deviceMemory;
  } else {
    Object.defineProperty(navigator, 'deviceMemory', { value: gb, configurable: true });
  }
}

/** Waits for the Nth (1-indexed) posted message of a given type and returns it. */
async function waitForMessageAt(worker: MockWorker, type: string, occurrence: number): Promise<any> {
  await vi.waitFor(() => {
    const matches = worker.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === type);
    expect(matches.length).toBeGreaterThanOrEqual(occurrence);
  });
  return worker.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === type)[occurrence - 1][0];
}

/** Same lookup, but for use inside a fake-timers block where vi.waitFor's own
 *  polling (backed by setTimeout) cannot be relied on to fire. The caller is
 *  responsible for having already let the relevant microtasks resolve. */
function lastMessageOfType(worker: MockWorker, type: string): any {
  const matches = worker.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === type);
  return matches[matches.length - 1][0];
}

/** Drains the microtask queue (Promise resolution is never faked by
 *  vi.useFakeTimers()) until `predicate` holds or `maxTicks` is exhausted.
 *  Used instead of vi.waitFor inside a fake-timers block, since vi.waitFor's
 *  own polling is backed by a real setTimeout that fake timers never fire. */
async function flushUntil(predicate: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve();
  }
  expect(predicate()).toBe(true);
}

const fakeResult = (model: string, text: string) => ({
  text,
  sentenceEnds: [text.length],
  breakpoints: [text.length],
  model,
});

describe('PunctuationRuntime', () => {
  let isModelReady: Mock;
  let getModelBlobUrls: Mock;
  let revokeBlobUrls: Mock;
  let downloadModel: Mock;

  beforeEach(() => {
    // vi.mock()'s module-level mocks (createPunctuationWorker, checkWebGPU)
    // persist as the same function object across tests; only mockClear()
    // makes each test start from a call count of zero for them.
    vi.clearAllMocks();
    MockWorker.reset();
    (createPunctuationWorker as unknown as Mock).mockImplementation((backend: 'webgpu' | 'wasm') => {
      const worker = new MockWorker(backend);
      // Mirrors installPunctuationWorker: the real worker posts 'ready'
      // unprompted as soon as its module finishes evaluating, independent of
      // whatever the main thread sends it.
      queueMicrotask(() => worker.emit({ type: 'ready', loadTimeMs: 0, device: backend }));
      return worker as unknown as Worker;
    });
    (checkWebGPU as unknown as Mock).mockResolvedValue({ available: false });
    setDeviceMemory(8);
    localStorage.removeItem('debug:device-memory');

    isModelReady = vi.spyOn(ModelManager.prototype, 'isModelReady').mockResolvedValue(false) as unknown as Mock;
    getModelBlobUrls = vi.spyOn(ModelManager.prototype, 'getModelBlobUrls').mockResolvedValue({}) as unknown as Mock;
    revokeBlobUrls = vi.spyOn(ModelManager.prototype, 'revokeBlobUrls').mockImplementation(() => {}) as unknown as Mock;
    downloadModel = vi.spyOn(ModelManager.prototype, 'downloadModel').mockImplementation(
      () => new Promise(() => {}),
    ) as unknown as Mock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    setDeviceMemory(undefined);
  });

  function makeRuntime(enabled = true) {
    const onStatus = vi.fn();
    const onDownloadProgress = vi.fn();
    const onLoaded = vi.fn();
    const runtime = new PunctuationRuntime({
      isEnabled: () => enabled,
      onStatus,
      onDownloadProgress,
      onLoaded,
    });
    return { runtime, onStatus, onDownloadProgress, onLoaded };
  }

  /** Drives the edge-punct-en model (via lang 'en') all the way to 'ready'
   *  over one shared worker, returning that worker for further interaction. */
  async function bringReady(
    runtime: PunctuationRuntime,
    onStatus: Mock,
    lang: string,
    modelId: string,
  ): Promise<MockWorker> {
    isModelReady.mockResolvedValue(true);
    getModelBlobUrls.mockResolvedValue({});
    await expect(runtime.punctuate(lang, 'priming call')).resolves.toBeNull();
    await vi.waitFor(() => expect(MockWorker.instances.length).toBeGreaterThanOrEqual(1));
    const worker = MockWorker.last();
    const loadMsg = await waitForMessageAt(worker, 'load', 1);
    worker.emit({ type: 'loaded', id: loadMsg.id, model: modelId, loadTimeMs: 10, device: 'wasm' });
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith(modelId, 'ready'));
    // The blob URLs handed to the worker for this load are revoked once it
    // confirms the files are read, exactly as the other engines do.
    expect(revokeBlobUrls).toHaveBeenCalled();
    return worker;
  }

  it('creates the worker lazily: no Worker before the first punctuate()', () => {
    makeRuntime();
    expect(MockWorker.instances.length).toBe(0);
    expect(createPunctuationWorker).not.toHaveBeenCalled();
  });

  it('starts one download when the model is not downloaded, and does not start a second on the next call', async () => {
    const { runtime } = makeRuntime();
    isModelReady.mockResolvedValue(false);

    await expect(runtime.punctuate('en', 'hello')).resolves.toBeNull();
    expect(downloadModel).toHaveBeenCalledTimes(1);
    expect(downloadModel).toHaveBeenCalledWith(MODEL_IDS['edge-punct-en'], expect.any(Function));

    await expect(runtime.punctuate('en', 'hello again')).resolves.toBeNull();
    expect(downloadModel).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances.length).toBe(0);
  });

  it('returns null while the model is loading', async () => {
    const { runtime, onStatus } = makeRuntime();
    isModelReady.mockResolvedValue(true);
    getModelBlobUrls.mockImplementation(() => new Promise(() => {})); // never resolves -> stuck loading

    await expect(runtime.punctuate('ja', 'hello')).resolves.toBeNull();
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('sat-3l-sm', 'loading'));

    await expect(runtime.punctuate('ja', 'hello again')).resolves.toBeNull();
    expect(MockWorker.instances.length).toBe(1); // no second worker/load attempt
  });

  it('a loaded model returns the worker result', async () => {
    const { runtime, onStatus } = makeRuntime();
    const worker = await bringReady(runtime, onStatus, 'ja', 'sat-3l-sm');

    const p = runtime.punctuate('ja', 'hello again');
    const runMsg = await waitForMessageAt(worker, 'run', 1);
    expect(runMsg.model).toBe('sat-3l-sm');
    const result = fakeResult('sat-3l-sm', 'hello again.');
    worker.emit({ type: 'result', id: runMsg.id, result, inferenceMs: 5 });
    await expect(p).resolves.toEqual(result);
  });

  it('two punctuate() calls for different models racing through checkWebGPU() share exactly one worker', async () => {
    // Regression for a bug where ensureSession()'s `if (this.session) return
    // this.session;` guard and its `this.session = session` assignment
    // straddle an `await checkWebGPU()`: two punctuate() calls for different
    // models (the exact zh<->en case one worker is shared for) can both pass
    // the guard before either assignment lands, creating two Workers, with
    // whichever model's worker loses the `this.session` race left orphaned.
    const { runtime, onStatus } = makeRuntime();
    isModelReady.mockResolvedValue(true);
    getModelBlobUrls.mockResolvedValue({});

    let resolveWebGpu!: (v: { available: boolean }) => void;
    (checkWebGPU as unknown as Mock).mockReturnValue(
      new Promise((resolve) => { resolveWebGpu = resolve; }),
    );

    const p1 = runtime.punctuate('en', 'hello'); // edge-punct-en
    const p2 = runtime.punctuate('zh', '你好');    // fireredpunc
    await expect(p1).resolves.toBeNull();
    await expect(p2).resolves.toBeNull();

    // Both calls' ensureSession() are now blocked on the same pending
    // checkWebGPU() promise -- the race window itself.
    resolveWebGpu({ available: false });

    await vi.waitFor(() => expect(MockWorker.instances.length).toBeGreaterThanOrEqual(1));
    // Give a second (buggy) worker every opportunity to also materialize
    // before asserting there is exactly one.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(createPunctuationWorker).toHaveBeenCalledTimes(1);
    expect(MockWorker.instances.length).toBe(1);

    const worker = MockWorker.last();
    await vi.waitFor(() => {
      const loads = worker.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === 'load');
      expect(loads.length).toBe(2);
    });
    const loads = worker.postMessage.mock.calls
      .filter((c: any[]) => c[0]?.type === 'load')
      .map((c: any[]) => c[0]);
    for (const msg of loads) {
      worker.emit({ type: 'loaded', id: msg.id, model: msg.model, loadTimeMs: 10, device: 'wasm' });
    }
    await vi.waitFor(() => {
      expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'ready');
      expect(onStatus).toHaveBeenCalledWith('fireredpunc', 'ready');
    });

    // Both models must then run successfully on the one shared worker.
    const runEnP = runtime.punctuate('en', 'hi again');
    const runZhP = runtime.punctuate('zh', '你好吗');
    await vi.waitFor(() => {
      const runs = worker.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === 'run');
      expect(runs.length).toBe(2);
    });
    const runs = worker.postMessage.mock.calls
      .filter((c: any[]) => c[0]?.type === 'run')
      .map((c: any[]) => c[0]);
    const runEnMsg = runs.find((m: any) => m.model === 'edge-punct-en');
    const runZhMsg = runs.find((m: any) => m.model === 'fireredpunc');
    const enResult = fakeResult('edge-punct-en', 'hi again.');
    const zhResult = fakeResult('fireredpunc', '你好吗?');
    worker.emit({ type: 'result', id: runEnMsg.id, result: enResult, inferenceMs: 3 });
    worker.emit({ type: 'result', id: runZhMsg.id, result: zhResult, inferenceMs: 4 });
    await expect(runEnP).resolves.toEqual(enResult);
    await expect(runZhP).resolves.toEqual(zhResult);
  });

  it('two different models can be resident on the shared worker at the same time', async () => {
    const { runtime, onStatus } = makeRuntime();
    const worker = await bringReady(runtime, onStatus, 'en', 'edge-punct-en');

    // Bring a second, different model up on the SAME worker instance.
    await expect(runtime.punctuate('zh', '你好')).resolves.toBeNull();
    const loadMsg = await waitForMessageAt(worker, 'load', 2);
    expect(loadMsg.model).toBe('fireredpunc');
    worker.emit({ type: 'loaded', id: loadMsg.id, model: 'fireredpunc', loadTimeMs: 12, device: 'wasm' });
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('fireredpunc', 'ready'));
    expect(MockWorker.instances.length).toBe(1); // still just the one worker

    // Both models now answer independently on that same worker.
    const pEn = runtime.punctuate('en', 'hi');
    const pZh = runtime.punctuate('zh', '你好吗');
    await vi.waitFor(() => {
      const runs = worker.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === 'run');
      expect(runs.length).toBe(2);
    });
    const runs = worker.postMessage.mock.calls
      .filter((c: any[]) => c[0]?.type === 'run')
      .map((c: any[]) => c[0]);
    const runEnMsg = runs.find((m: any) => m.model === 'edge-punct-en');
    const runZhMsg = runs.find((m: any) => m.model === 'fireredpunc');
    const enResult = fakeResult('edge-punct-en', 'hi.');
    const zhResult = fakeResult('fireredpunc', '你好吗?');
    worker.emit({ type: 'result', id: runEnMsg.id, result: enResult, inferenceMs: 3 });
    worker.emit({ type: 'result', id: runZhMsg.id, result: zhResult, inferenceMs: 4 });
    await expect(pEn).resolves.toEqual(enResult);
    await expect(pZh).resolves.toEqual(zhResult);
  });

  it('arms the idle-unload timer on a successful load, even with no inference call yet', async () => {
    // Regression: touch() was previously only called from runInference(), so
    // a model that loaded successfully and was never actually queried had no
    // idle timer at all and stayed resident indefinitely.
    const { runtime, onStatus } = makeRuntime();
    isModelReady.mockResolvedValue(true);
    getModelBlobUrls.mockResolvedValue({});

    vi.useFakeTimers();
    try {
      void runtime.punctuate('en', 'a'); // kicks off the load only
      await flushUntil(() => MockWorker.instances.length >= 1);
      const worker = MockWorker.last();
      await flushUntil(() => worker.postMessage.mock.calls.some((c: any[]) => c[0]?.type === 'load'));
      const loadMsg = lastMessageOfType(worker, 'load');
      worker.emit({ type: 'loaded', id: loadMsg.id, model: 'edge-punct-en', loadTimeMs: 10, device: 'wasm' });
      await flushUntil(() => onStatus.mock.calls.some((c: any[]) => c[0] === 'edge-punct-en' && c[1] === 'ready'));

      // No punctuate() call happens after this -- the load itself must have
      // armed the idle timer, or this model stays resident forever.
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'unload', model: 'edge-punct-en' }),
      );
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('three consecutive failures disable that model for the session', async () => {
    const { runtime, onStatus } = makeRuntime();
    const worker = await bringReady(runtime, onStatus, 'en', 'edge-punct-en');

    for (let i = 1; i <= 3; i++) {
      const p = runtime.punctuate('en', `try ${i}`);
      const msg = await waitForMessageAt(worker, 'run', i);
      worker.emit({ type: 'error', id: msg.id, error: 'boom' });
      await expect(p).resolves.toBeNull();
    }

    expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'disabled', expect.any(String));

    worker.postMessage.mockClear();
    await expect(runtime.punctuate('en', 'after disable')).resolves.toBeNull();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('a worker crash restarts once; the second crash disables models', async () => {
    const { runtime, onStatus } = makeRuntime();
    isModelReady.mockResolvedValue(true);
    getModelBlobUrls.mockResolvedValue({});

    await runtime.punctuate('en', 'a'); // kicks off the load, worker #1
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    const worker1 = MockWorker.last();
    worker1.emitError('boom');
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'downloaded', expect.any(String)),
    );
    expect(worker1.terminate).toHaveBeenCalledTimes(1);

    await runtime.punctuate('en', 'b'); // restarts: a fresh worker #2
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(2));
    const worker2 = MockWorker.last();
    worker2.emitError('boom again');
    await vi.waitFor(() => {
      expect(onStatus).toHaveBeenCalledWith('fireredpunc', 'disabled', expect.any(String));
      expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'disabled', expect.any(String));
      expect(onStatus).toHaveBeenCalledWith('sat-3l-sm', 'disabled', expect.any(String));
    });

    await expect(runtime.punctuate('en', 'c')).resolves.toBeNull();
    expect(MockWorker.instances.length).toBe(2); // no third worker
  });

  it('a WebGPU load failure recreates the worker with the wasm entry', async () => {
    const { runtime, onStatus } = makeRuntime();
    (checkWebGPU as unknown as Mock).mockResolvedValue({ available: true });
    isModelReady.mockResolvedValue(true);
    getModelBlobUrls.mockResolvedValue({});

    const p = runtime.punctuate('ja', 'hello');
    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(1));
    expect(createPunctuationWorker).toHaveBeenLastCalledWith('webgpu');
    const worker1 = MockWorker.last();
    const loadMsg1 = await waitForMessageAt(worker1, 'load', 1);
    worker1.emit({ type: 'error', id: loadMsg1.id, error: 'no webgpu adapter' });

    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(2));
    expect(createPunctuationWorker).toHaveBeenLastCalledWith('wasm');
    const worker2 = MockWorker.last();
    const loadMsg2 = await waitForMessageAt(worker2, 'load', 1);
    worker2.emit({ type: 'loaded', id: loadMsg2.id, model: 'sat-3l-sm', loadTimeMs: 800, device: 'wasm' });

    await expect(p).resolves.toBeNull(); // the original call already returned null (fire-and-forget load)
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('sat-3l-sm', 'ready'));

    const p2 = runtime.punctuate('ja', 'hello again');
    const runMsg = await waitForMessageAt(worker2, 'run', 1);
    const result = fakeResult('sat-3l-sm', 'hello again.');
    worker2.emit({ type: 'result', id: runMsg.id, result, inferenceMs: 5 });
    await expect(p2).resolves.toEqual(result);
  });

  it('a WebGPU fallback resets every other model resident on the shared worker, not only the one that failed', async () => {
    // Regression: the fallback used to call teardownSession() (which rejects
    // every in-flight load and bumps the epoch) and then restart only the
    // model whose load had just failed. Any OTHER model sharing that worker
    // -- exactly the zh<->en case this worker is shared for -- was left
    // orphaned: a 'ready' one kept pointing at an adapter that no longer
    // exists, and a 'loading' one stayed 'loading' forever, because its own
    // performLoad() catch bails out silently once teardownSession() has
    // already bumped the epoch out from under it.
    const { runtime, onStatus } = makeRuntime();
    (checkWebGPU as unknown as Mock).mockResolvedValue({ available: true });
    isModelReady.mockResolvedValue(true);
    getModelBlobUrls.mockResolvedValue({});

    // en (edge-punct-en) is already fully resident ('ready') on the webgpu
    // worker.
    const worker1 = await bringReady(runtime, onStatus, 'en', 'edge-punct-en');
    expect(createPunctuationWorker).toHaveBeenLastCalledWith('webgpu');

    // zh (fireredpunc) starts loading on the same worker, but its load has
    // not settled yet.
    const pZh = runtime.punctuate('zh', '你好');
    await waitForMessageAt(worker1, 'load', 2);
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('fireredpunc', 'loading'));

    // ja (sat-3l-sm) load fails on webgpu -> fallback to wasm.
    const pJa = runtime.punctuate('ja', 'hello');
    const jaLoadMsg = await waitForMessageAt(worker1, 'load', 3);
    worker1.emit({ type: 'error', id: jaLoadMsg.id, error: 'no webgpu adapter' });

    await vi.waitFor(() => expect(MockWorker.instances.length).toBe(2));
    expect(createPunctuationWorker).toHaveBeenLastCalledWith('wasm');
    const worker2 = MockWorker.last();

    // Both the ready model and the loading model must be reset so they can
    // reload on the replacement worker, instead of one staying 'ready' with
    // a dead adapter and the other stuck 'loading' forever.
    await vi.waitFor(() => {
      expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'downloaded', expect.any(String));
      expect(onStatus).toHaveBeenCalledWith('fireredpunc', 'downloaded', expect.any(String));
    });

    // ja reloads on the wasm worker as before.
    const jaLoadMsg2 = await waitForMessageAt(worker2, 'load', 1);
    worker2.emit({ type: 'loaded', id: jaLoadMsg2.id, model: 'sat-3l-sm', loadTimeMs: 800, device: 'wasm' });
    await expect(pJa).resolves.toBeNull();
    await expect(pZh).resolves.toBeNull(); // zh's original call: fire-and-forget, still resolves null

    // en and zh must both actually be reloadable now -- not stuck refused
    // forever the way a stale 'ready' or 'loading' status would have left
    // them (prepareModel refuses to touch either). Each of these calls only
    // kicks off the reload and resolves null itself (prepareModel returns
    // false while the model is loading); a separate call once each model is
    // 'ready' is what actually reaches runInference().
    await expect(runtime.punctuate('en', 'hi again')).resolves.toBeNull();
    const enLoadMsg2 = await waitForMessageAt(worker2, 'load', 2);
    expect(enLoadMsg2.model).toBe('edge-punct-en');
    worker2.emit({ type: 'loaded', id: enLoadMsg2.id, model: 'edge-punct-en', loadTimeMs: 9, device: 'wasm' });
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'ready'));

    await expect(runtime.punctuate('zh', '你好吗')).resolves.toBeNull();
    const zhLoadMsg2 = await waitForMessageAt(worker2, 'load', 3);
    expect(zhLoadMsg2.model).toBe('fireredpunc');
    worker2.emit({ type: 'loaded', id: zhLoadMsg2.id, model: 'fireredpunc', loadTimeMs: 12, device: 'wasm' });
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith('fireredpunc', 'ready'));

    const runEn = runtime.punctuate('en', 'hi once more');
    const runZh = runtime.punctuate('zh', '你好吗再一次');
    const runEnMsg = await waitForMessageAt(worker2, 'run', 1);
    const runZhMsg = await waitForMessageAt(worker2, 'run', 2);
    const enResult = fakeResult('edge-punct-en', 'hi once more.');
    const zhResult = fakeResult('fireredpunc', '你好吗再一次?');
    worker2.emit({ type: 'result', id: runEnMsg.id, result: enResult, inferenceMs: 3 });
    worker2.emit({ type: 'result', id: runZhMsg.id, result: zhResult, inferenceMs: 4 });
    await expect(runEn).resolves.toEqual(enResult);
    await expect(runZh).resolves.toEqual(zhResult);
  });


  it('a call that exceeds 3 s resolves null', async () => {
    const { runtime, onStatus } = makeRuntime();
    const worker = await bringReady(runtime, onStatus, 'en', 'edge-punct-en');

    vi.useFakeTimers();
    try {
      const p = runtime.punctuate('en', 'slow');
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }

    // A late reply for the timed-out request must not throw.
    const runMsg = lastMessageOfType(worker, 'run');
    expect(() =>
      worker.emit({ type: 'result', id: runMsg.id, result: fakeResult('edge-punct-en', 'x'), inferenceMs: 3500 }),
    ).not.toThrow();
  });

  it('navigator.deviceMemory <= 4 loads nothing and always returns null', async () => {
    setDeviceMemory(4);
    const { runtime } = makeRuntime();
    isModelReady.mockResolvedValue(true);

    await expect(runtime.punctuate('en', 'hello')).resolves.toBeNull();
    expect(isModelReady).not.toHaveBeenCalled();
    expect(MockWorker.instances.length).toBe(0);
  });

  it('a model unused for 2 minutes unloads, and the worker terminates once it holds none', async () => {
    const { runtime, onStatus } = makeRuntime();
    isModelReady.mockResolvedValue(true);
    getModelBlobUrls.mockResolvedValue({});

    // The whole flow runs under fake timers from the start: touch()'s idle
    // timer is scheduled via the real setTimeout the instant it is set, so
    // enabling fake timers only after that point would leave it running on
    // its own, unadvanceable, real clock.
    vi.useFakeTimers();
    try {
      void runtime.punctuate('en', 'a'); // kicks off the load
      await flushUntil(() => MockWorker.instances.length >= 1);
      const worker = MockWorker.last();
      await flushUntil(() => worker.postMessage.mock.calls.some((c: any[]) => c[0]?.type === 'load'));
      const loadMsg = lastMessageOfType(worker, 'load');
      worker.emit({ type: 'loaded', id: loadMsg.id, model: 'edge-punct-en', loadTimeMs: 10, device: 'wasm' });
      await flushUntil(() => onStatus.mock.calls.some((c: any[]) => c[0] === 'edge-punct-en' && c[1] === 'ready'));

      // Use it once, so the idle clock starts from a real "last used" moment.
      const runP = runtime.punctuate('en', 'b');
      await flushUntil(() => worker.postMessage.mock.calls.some((c: any[]) => c[0]?.type === 'run'));
      const runMsg = lastMessageOfType(worker, 'run');
      worker.emit({ type: 'result', id: runMsg.id, result: fakeResult('edge-punct-en', 'b.'), inferenceMs: 1 });
      await expect(runP).resolves.toEqual(fakeResult('edge-punct-en', 'b.'));

      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'unload', model: 'edge-punct-en' }),
      );
      expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'downloaded', expect.any(String));
      expect(worker.terminate).toHaveBeenCalledTimes(1); // the only model held -> worker torn down
    } finally {
      vi.useRealTimers();
    }
  });

  it('enabled === false makes punctuate() return null without touching the worker or the ModelManager', async () => {
    const { runtime } = makeRuntime(false);
    expect(runtime.enabled).toBe(false);

    await expect(runtime.punctuate('en', 'hello')).resolves.toBeNull();
    expect(isModelReady).not.toHaveBeenCalled();
    expect(downloadModel).not.toHaveBeenCalled();
    expect(MockWorker.instances.length).toBe(0);
  });

  it('a download failure does not retry automatically in the same launch', async () => {
    const { runtime, onStatus } = makeRuntime();
    isModelReady.mockResolvedValue(false);
    downloadModel.mockRejectedValueOnce(new Error('network down'));

    await expect(runtime.punctuate('en', 'hello')).resolves.toBeNull();
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'error', expect.any(String)),
    );
    expect(downloadModel).toHaveBeenCalledTimes(1);

    await expect(runtime.punctuate('en', 'hello again')).resolves.toBeNull();
    expect(downloadModel).toHaveBeenCalledTimes(1);
  });

  it('a manual retry after a failure starts exactly one new download', async () => {
    const { runtime, onStatus } = makeRuntime();
    isModelReady.mockResolvedValue(false);
    downloadModel.mockRejectedValueOnce(new Error('network down'));

    await runtime.punctuate('en', 'hello');
    await vi.waitFor(() =>
      expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'error', expect.any(String)),
    );

    downloadModel.mockImplementationOnce(() => new Promise(() => {}));
    runtime.retryDownload('edge-punct-en');
    expect(downloadModel).toHaveBeenCalledTimes(2);

    runtime.retryDownload('edge-punct-en'); // status is now 'downloading', not 'error' -> no-op
    expect(downloadModel).toHaveBeenCalledTimes(2);
  });

  it('once the median call latency stays above 500 ms, that model goes rule-only for the session', async () => {
    const { runtime, onStatus } = makeRuntime();
    const worker = await bringReady(runtime, onStatus, 'en', 'edge-punct-en');

    vi.useFakeTimers();
    try {
      for (let i = 1; i <= 3; i++) {
        const p = runtime.punctuate('en', `slow ${i}`);
        await vi.advanceTimersByTimeAsync(0); // let the run message actually post
        const msg = lastMessageOfType(worker, 'run');
        await vi.advanceTimersByTimeAsync(600); // 600ms > the 500ms budget
        worker.emit({ type: 'result', id: msg.id, result: fakeResult('edge-punct-en', `slow ${i}.`), inferenceMs: 600 });
        await expect(p).resolves.toEqual(fakeResult('edge-punct-en', `slow ${i}.`));
      }
      expect(onStatus).toHaveBeenCalledWith('edge-punct-en', 'disabled', expect.any(String));

      worker.postMessage.mockClear();
      const p4 = runtime.punctuate('en', 'after slow disable');
      await vi.advanceTimersByTimeAsync(0);
      await expect(p4).resolves.toBeNull();
      expect(worker.postMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose() rejects every in-flight request and terminates the worker; a late result touches nothing', async () => {
    const { runtime, onStatus } = makeRuntime();
    const worker = await bringReady(runtime, onStatus, 'en', 'edge-punct-en');

    const p = runtime.punctuate('en', 'in flight');
    const runMsg = await waitForMessageAt(worker, 'run', 1);

    runtime.dispose();
    await expect(p).resolves.toBeNull(); // SegmentationRuntime.punctuate never rejects
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    expect(() =>
      worker.emit({ type: 'result', id: runMsg.id, result: fakeResult('edge-punct-en', 'x'), inferenceMs: 1 }),
    ).not.toThrow();
  });
});
