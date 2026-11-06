import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FormFactor, NativeOutputsResult, OutputDeviceInfo } from './formFactor';

const reportWarningSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportWarning: reportWarningSpy };
});

import {
  RETRY_DELAYS_MS,
  createNativeOutputReader,
  currentNativeOutputs,
  requestForSync,
  startNativeOutputs,
} from './nativeOutputs';

const dev = (label: string, formFactor: FormFactor = 'speakers', isDefault = false): OutputDeviceInfo => ({
  label,
  isDefault,
  formFactor,
  transport: 'builtin',
  raw: {},
});
const A = [dev('Speakers', 'speakers', true)];
const B = [dev('Speakers', 'speakers'), dev('Headphones', 'headphones', true)];
const ok = (devices: OutputDeviceInfo[]): NativeOutputsResult => ({ ok: true, devices });
const FAILED: NativeOutputsResult = { ok: false, reason: 'timeout' };

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A reader on a manual clock, whose reads resolve only when the test says so. */
function harness() {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const reads: Array<{ startedAt: number; resolve: (r: NativeOutputsResult) => void }> = [];
  const onUpdate = vi.fn();
  const reader = createNativeOutputReader({
    read: () => new Promise((resolve) => reads.push({ startedAt: t, resolve })),
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (h) => {
      timers.delete(h as number);
    },
    onUpdate,
  });
  return {
    reader,
    reads,
    timers,
    onUpdate,
    async advance(ms: number) {
      t += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= t) {
          timers.delete(id);
          timer.fn();
        }
      }
      await flush();
    },
    async resolve(i: number, result: NativeOutputsResult) {
      reads[i].resolve(result);
      await flush();
    },
  };
}

describe('createNativeOutputReader', () => {
  it('never read is null', async () => {
    const h = harness();
    expect(h.reader.current()).toBeNull();
    h.reader.request('first');
    await flush();
    expect(h.reader.current()).toBeNull();
  });

  it('a success makes it current', async () => {
    const h = harness();
    h.reader.request('first');
    expect(h.reads).toHaveLength(1);
    await h.resolve(0, ok(A));
    expect(h.reader.current()).toEqual(A);
  });

  it('an event after the last good read makes it stale until the re-read succeeds', async () => {
    const h = harness();
    h.reader.request('first');
    await h.resolve(0, ok(A));

    h.reader.request('devicechange');
    expect(h.reader.current()).toBeNull();
    expect(h.reads).toHaveLength(2);
    // A failed re-read leaves it stale: never the remembered answer.
    await h.resolve(1, FAILED);
    expect(h.reader.current()).toBeNull();

    await h.advance(RETRY_DELAYS_MS[0]);
    expect(h.reads).toHaveLength(3);
    await h.resolve(2, ok(B));
    expect(h.reader.current()).toEqual(B);
  });

  it('an event during a read is not answered by that read', async () => {
    const h = harness();
    h.reader.request('first'); // t=0: the read starts
    await h.advance(5);
    h.reader.request('push'); // t=5: the event, while that read is in flight
    expect(h.reads).toHaveLength(1);
    await h.advance(1);
    await h.resolve(0, ok(A)); // t=6: it resolves, but it started before the event
    expect(h.reader.current()).toBeNull();
    expect(h.reads).toHaveLength(2);
    expect(h.reads[1].startedAt).toBe(6);

    await h.resolve(1, ok(A));
    expect(h.reader.current()).toEqual(A);
  });

  it('a failed read retries after 1 s, 5 s and 30 s, then stops', async () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 5000, 30000]);
    const h = harness();
    h.reader.request('first');
    await h.resolve(0, FAILED);

    await h.advance(999);
    expect(h.reads).toHaveLength(1);
    await h.advance(1);
    expect(h.reads).toHaveLength(2);
    await h.resolve(1, FAILED);

    await h.advance(4999);
    expect(h.reads).toHaveLength(2);
    await h.advance(1);
    expect(h.reads).toHaveLength(3);
    await h.resolve(2, FAILED);

    await h.advance(29999);
    expect(h.reads).toHaveLength(3);
    await h.advance(1);
    expect(h.reads).toHaveLength(4);
    await h.resolve(3, FAILED);

    // The third retry failed too: nothing more until the next event.
    await h.advance(10 * 60_000);
    expect(h.reads).toHaveLength(4);
    expect(h.timers.size).toBe(0);
    expect(h.reader.current()).toBeNull();

    // The next event reads again, with the whole retry schedule ahead of it.
    h.reader.request('visible');
    expect(h.reads).toHaveLength(5);
    await h.resolve(4, FAILED);
    await h.advance(1000);
    expect(h.reads).toHaveLength(6);
  });

  it('a success ends the retries', async () => {
    const h = harness();
    h.reader.request('first');
    await h.resolve(0, FAILED);
    await h.advance(1000);
    await h.resolve(1, ok(A));
    expect(h.reader.current()).toEqual(A);
    await h.advance(10 * 60_000);
    expect(h.reads).toHaveLength(2);
    expect(h.timers.size).toBe(0);
  });

  it('a request cancels a pending retry and reads now', async () => {
    const h = harness();
    h.reader.request('first');
    await h.resolve(0, FAILED);
    expect(h.timers.size).toBe(1);

    h.reader.request('visible');
    expect(h.timers.size).toBe(0);
    expect(h.reads).toHaveLength(2);
    await h.advance(1000);
    expect(h.reads).toHaveLength(2);

    // Its own failure starts the schedule over at 1 s.
    await h.resolve(1, FAILED);
    await h.advance(999);
    expect(h.reads).toHaveLength(2);
    await h.advance(1);
    expect(h.reads).toHaveLength(3);
  });

  it('onUpdate fires on fresh → stale and on new devices, not on an identical re-read', async () => {
    const h = harness();
    h.reader.request('first');
    expect(h.onUpdate).not.toHaveBeenCalled(); // stale stays stale
    await h.resolve(0, ok(A));
    expect(h.onUpdate).toHaveBeenCalledTimes(1); // new devices

    h.reader.request('devicechange');
    expect(h.onUpdate).toHaveBeenCalledTimes(2); // fresh → stale
    h.reader.request('push');
    expect(h.onUpdate).toHaveBeenCalledTimes(2); // already stale

    // The in-flight re-read brings the same devices, but it predates the push:
    // the answer stays stale, so nothing a caller reads changed.
    await h.resolve(1, ok(A));
    expect(h.reader.current()).toBeNull();
    expect(h.onUpdate).toHaveBeenCalledTimes(2);
    // Nor does a failed read while stale.
    await h.resolve(2, FAILED);
    expect(h.onUpdate).toHaveBeenCalledTimes(2);

    await h.advance(1000);
    await h.resolve(3, ok(B));
    expect(h.reader.current()).toEqual(B);
    expect(h.onUpdate).toHaveBeenCalledTimes(3); // new devices
  });

  it('dispose cancels timers', async () => {
    const h = harness();
    h.reader.request('first');
    await h.resolve(0, FAILED);
    expect(h.timers.size).toBe(1);

    h.reader.dispose();
    expect(h.timers.size).toBe(0);
    h.reader.request('push');
    expect(h.reads).toHaveLength(1);
  });

  it('a read that settles after dispose starts nothing and tells no one', async () => {
    const h = harness();
    h.reader.request('first');
    h.reader.dispose();
    await h.resolve(0, FAILED);
    expect(h.timers.size).toBe(0);
    expect(h.onUpdate).not.toHaveBeenCalled();
  });

  it('a read that rejects or throws counts as a failed read', async () => {
    const timers: Array<() => void> = [];
    const read = vi.fn<() => Promise<NativeOutputsResult>>()
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockImplementationOnce(() => {
        throw new Error('no ipc');
      })
      .mockResolvedValueOnce(ok(A));
    const reader = createNativeOutputReader({
      read,
      setTimeout: (fn) => timers.push(fn),
      clearTimeout: () => {},
      onUpdate: () => {},
    });
    reader.request('first');
    await flush();
    expect(timers).toHaveLength(1);
    timers[0]();
    await flush();
    expect(timers).toHaveLength(2);
    timers[1]();
    await flush();
    expect(reader.current()).toEqual(A);
  });
});

describe('startNativeOutputs', () => {
  type Listener = (...args: unknown[]) => void;

  function fakeIpc(result: () => Promise<NativeOutputsResult> = async () => ok(A)) {
    const pushes: Listener[] = [];
    return {
      pushes,
      invoke: vi.fn((_channel: string) => result()),
      receive: vi.fn((_channel: string, fn: Listener) => {
        pushes.push(fn);
      }),
      removeListener: vi.fn((_channel: string, fn: Listener) => {
        pushes.splice(pushes.indexOf(fn), 1);
      }),
    };
  }

  function fakeDoc() {
    const target = new EventTarget();
    return Object.assign(target, { visibilityState: 'visible' as DocumentVisibilityState });
  }

  const started: Array<{ dispose(): void }> = [];
  const start = (...args: Parameters<typeof startNativeOutputs>) => {
    const native = startNativeOutputs(...args);
    started.push(native);
    return native;
  };

  beforeEach(() => {
    reportWarningSpy.mockClear();
  });
  afterEach(() => {
    while (started.length) started.pop()!.dispose();
  });

  it('startNativeOutputs reads once at start', async () => {
    const ipc = fakeIpc();
    start(() => {}, { ipc, doc: fakeDoc() });
    expect(ipc.invoke).toHaveBeenCalledTimes(1);
    expect(ipc.invoke).toHaveBeenCalledWith('get-output-devices');
    expect(ipc.receive).toHaveBeenCalledWith('output-devices:changed', expect.any(Function));
    await flush();
    expect(ipc.invoke).toHaveBeenCalledTimes(1);
  });

  it('a push and a return to visible each request a read', async () => {
    const ipc = fakeIpc();
    const doc = fakeDoc();
    start(() => {}, { ipc, doc });
    await flush();

    ipc.pushes[0]();
    await flush();
    expect(ipc.invoke).toHaveBeenCalledTimes(2);

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(ipc.invoke).toHaveBeenCalledTimes(2);

    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(ipc.invoke).toHaveBeenCalledTimes(3);
  });

  it('requestForSync: change requests devicechange, poll requests nothing', async () => {
    const ipc = fakeIpc();
    const native = start(() => {}, { ipc, doc: fakeDoc() });
    await flush();

    requestForSync(native, 'poll');
    await flush();
    expect(ipc.invoke).toHaveBeenCalledTimes(1);

    requestForSync(native, 'change');
    await flush();
    expect(ipc.invoke).toHaveBeenCalledTimes(2);

    const spy = { request: vi.fn() };
    requestForSync(spy, 'change');
    requestForSync(spy, 'poll');
    expect(spy.request.mock.calls).toEqual([['devicechange']]);
    // No reader (the extension): nothing to ask.
    expect(() => requestForSync(null, 'change')).not.toThrow();
  });

  it('dispose removes the listeners', async () => {
    const ipc = fakeIpc();
    const doc = fakeDoc();
    const native = start(() => {}, { ipc, doc });
    await flush();
    const push = ipc.pushes[0];

    native.dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith('output-devices:changed', push);
    doc.dispatchEvent(new Event('visibilitychange'));
    push(); // a push already queued when the listener went
    await flush();
    expect(ipc.invoke).toHaveBeenCalledTimes(1);
  });

  it('currentNativeOutputs is what the started reader holds, and null with none started', async () => {
    expect(currentNativeOutputs()).toBeNull();
    const onUpdate = vi.fn();
    const native = start(onUpdate, { ipc: fakeIpc(), doc: fakeDoc() });
    await flush();
    expect(currentNativeOutputs()).toEqual(A);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    native.dispose();
    expect(currentNativeOutputs()).toBeNull();
  });

  it('dispose tells onUpdate when it takes a current answer away, and not when there was none', async () => {
    const onUpdate = vi.fn();
    const native = start(onUpdate, { ipc: fakeIpc(), doc: fakeDoc() });
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    onUpdate.mockImplementation(() => expect(currentNativeOutputs()).toBeNull());
    native.dispose();
    expect(onUpdate).toHaveBeenCalledTimes(2);
    native.dispose();
    expect(onUpdate).toHaveBeenCalledTimes(2);

    // Stale when it goes: what currentNativeOutputs() gives does not change.
    const staleUpdate = vi.fn();
    const stale = start(staleUpdate, { ipc: fakeIpc(async () => FAILED), doc: fakeDoc() });
    await flush();
    stale.dispose();
    expect(staleUpdate).not.toHaveBeenCalled();
  });

  it('a failed read is reported as a warning, and reads unknown', async () => {
    const ipc = fakeIpc(async () => ({ ok: false, reason: 'no_helper' }));
    start(() => {}, { ipc, doc: fakeDoc() });
    await flush();
    expect(currentNativeOutputs()).toBeNull();
    expect(reportWarningSpy).toHaveBeenCalledTimes(1);
    expect(reportWarningSpy.mock.calls[0][0]).toBe('NativeOutputs');
    expect(reportWarningSpy.mock.calls[0][1]).toContain('no_helper');
    expect(reportWarningSpy.mock.calls[0][2]).toMatchObject({ dedupeKey: 'native-outputs:read' });
  });

  it('a native entry without a string label, or outside the known sets, is a failed read', async () => {
    const good = dev('Speakers', 'speakers', true);
    const malformed: unknown[][] = [
      [good, { ...good, label: undefined }], // a pactl sink block without a Description: line
      [{ ...good, label: 42 }],
      [{ ...good, isDefault: 'yes' }],
      [{ ...good, formFactor: 'earbuds' }],
      [{ ...good, transport: 'wifi' }],
      [{ ...good, formFactor: 'constructor' }], // an inherited key is no member
      [null],
    ];
    for (const devices of malformed) {
      reportWarningSpy.mockClear();
      const ipc = fakeIpc(async () => ({ ok: true, devices }) as unknown as NativeOutputsResult);
      const native = start(() => {}, { ipc, doc: fakeDoc() });
      await flush();
      expect(currentNativeOutputs()).toBeNull();
      expect(reportWarningSpy).toHaveBeenCalledTimes(1);
      expect(reportWarningSpy.mock.calls[0][1]).toContain('malformed answer');
      native.dispose();
    }
  });

  it('a malformed answer is retried like any failed read', async () => {
    vi.useFakeTimers();
    try {
      const answers: unknown[] = [{ ok: true, devices: [{ isDefault: true }] }, ok(A)];
      const ipc = fakeIpc(async () => answers.shift() as NativeOutputsResult);
      start(() => {}, { ipc, doc: fakeDoc() });
      await vi.advanceTimersByTimeAsync(0);
      expect(currentNativeOutputs()).toBeNull();
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
      expect(ipc.invoke).toHaveBeenCalledTimes(2);
      expect(currentNativeOutputs()).toEqual(A);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a malformed answer or a rejected invoke is a failed read', async () => {
    const ipc = fakeIpc(async () => ({ ok: true }) as unknown as NativeOutputsResult);
    start(() => {}, { ipc, doc: fakeDoc() });
    await flush();
    expect(currentNativeOutputs()).toBeNull();
    expect(reportWarningSpy).toHaveBeenCalledTimes(1);

    started.pop()!.dispose();
    const rejecting = fakeIpc(() => Promise.reject(new Error('No handler registered')));
    start(() => {}, { ipc: rejecting, doc: fakeDoc() });
    await flush();
    expect(currentNativeOutputs()).toBeNull();
    expect(reportWarningSpy).toHaveBeenCalledTimes(2);
    expect(reportWarningSpy.mock.calls[1][1]).toContain('No handler registered');
  });
});
