import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// The tab's one shared stream: a stand-in, so a test can see what the frames asked of it.
const tabStream = vi.hoisted(() => ({
  deps: { stand: 'in' },
  stream: { stream: {}, release: async () => {} },
}));
vi.mock('../lib/screen/tabStream', () => ({
  openTabStream: vi.fn(async () => tabStream.stream),
  chromeTabStreamDeps: vi.fn(() => tabStream.deps),
}));

// Seen, and kept off the console: a failure here is a warning and a run without frames.
const reportWarning = vi.hoisted(() => vi.fn());
vi.mock('../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/diagnostics/report')>()),
  reportWarning,
}));

import { createVirtualClock, type VirtualClock } from '../lib/contract/clock';
import type { FrameReason } from '../lib/contract/adapter';
import type { CaptureSourceInfo, Invoke } from '../lib/screen/desktopFrames';
import type { Capture, Picture } from '../lib/screen/sampler';
import type { TabCaptureDeps } from '../lib/screen/tabFrames';
import { openTabStream } from '../lib/screen/tabStream';
import { useScreenContextStore } from '../stores/screenContextStore';
import { chooseAgain, prepareScreenContext, releaseScreenContext, type PickedSource, type PickReason } from './screenContext';

// ---- fixtures (the sampler's own, sampler.test.ts) ---------------------------------------------

const W = 64;
const H = 36;

function solid(value: number): Picture {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([value, value, value, 255], i * 4);
  return { rgba, width: W, height: H };
}

/** A grey gradient left to right: never blank. */
function lit(seed = 1): Picture {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.round(20 + (x / W) * 100 + seed * 10);
      rgba.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { rgba, width: W, height: H };
}

const BLACK = solid(0);

interface Scripted extends Capture {
  close: Mock<() => void>;
  readonly grabs: number;
}

/** A capture that shows `picture` until it is closed, and yields nothing after. */
function scripted(picture: Picture, name: string, kind: Capture['kind'] = 'window'): Scripted {
  let grabs = 0;
  let closed = false;
  return {
    name,
    kind,
    get grabs() {
      return grabs;
    },
    async grab() {
      grabs += 1;
      return closed ? null : picture;
    },
    async encode() {
      return new Uint8Array([0xff, 0xd8, grabs]);
    },
    close: vi.fn<() => void>(() => { closed = true; }),
  };
}

const source = (id: string, name: string): CaptureSourceInfo => ({ id, name, kind: 'window', thumbnail: 'data:,', appIcon: null });
const SLIDES = source('window:1', 'Slides');
const DARK = source('window:2', 'Dark window');
const NOTES = source('window:3', 'Notes');

/** Lets every promise a beat chains on settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** A second at a time, each beat finishing before the next; a pick and its capture land before the first. */
async function run(clock: VirtualClock, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 1000) {
    await flush();
    clock.advance(1000);
    await flush();
  }
}

/** `picks` answers the picker in order; `opens` maps a source id to the capture it opens to. */
function deps(o: { picks?: Array<PickedSource | null>; opens?: Record<string, Scripted>; invoke?: Invoke } = {}) {
  const clock = createVirtualClock(0);
  const picks = [...(o.picks ?? [])];
  const pick = vi.fn(async (_reason?: PickReason) => picks.shift() ?? null);
  const openDesktop = vi.fn(async (s: Pick<CaptureSourceInfo, 'id' | 'name' | 'kind'>) => {
    const capture = o.opens?.[s.id];
    if (!capture) throw new Error(`no capture for ${s.id}`);
    return capture;
  });
  const openTab = vi.fn(async (_tabId: number, _deps: TabCaptureDeps): Promise<Scripted> => { throw new Error('no tab in this test'); });
  const invoke = o.invoke ?? (vi.fn(async () => { throw new Error('no IPC in this test'); }) as Invoke);
  return { clock, pick, openDesktop, openTab, invoke };
}

const store = () => useScreenContextStore.getState();

beforeEach(() => {
  useScreenContextStore.setState({ sampler: null, state: null });
  vi.clearAllMocks();
});

afterEach(() => {
  releaseScreenContext();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

// ---- Electron ---------------------------------------------------------------------------------

describe('prepareScreenContext — the desktop', () => {
  it('a cancelled pick leaves the store empty', async () => {
    const d = deps({ picks: [null] });
    await prepareScreenContext('electron', { legs: ['speaker'] }, d);
    expect(d.pick.mock.calls).toEqual([[undefined]]);
    expect(store().sampler).toBeNull();
    expect(store().state).toBeNull();
    expect(d.openDesktop).not.toHaveBeenCalled();
  });

  it('a pick with a frame puts its sampler in the store, mirroring its state, once the first frame is in hand', async () => {
    const slides = scripted(lit(), 'Slides');
    const d = deps({ picks: [{ kind: 'desktop', source: SLIDES }], opens: { [SLIDES.id]: slides } });
    let done = false;
    const prepared = prepareScreenContext('electron', { legs: ['speaker'] }, d).then(() => { done = true; });
    await flush();
    // Not before the first frame: a source without one would kill the Qwen session at its first turn.
    expect(store().sampler).toBeNull();
    expect(done).toBe(false);
    await run(d.clock, 1000);
    await prepared;
    expect(d.openDesktop).toHaveBeenCalledWith(SLIDES);
    expect(store().sampler!.source.name).toBe('Slides');
    expect(store().state).toMatchObject({ status: 'live', name: 'Slides', kind: 'window', sent: 1, lastReason: 'first' });
    // A leg that subscribes at its start has the first frame at once.
    const frames: FrameReason[] = [];
    store().sampler!.source.subscribe((_jpeg, reason) => frames.push(reason), () => {}, () => {});
    expect(frames).toEqual(['first']);
  });

  it('a pick whose area shows nothing is closed and the picker asked again with the reason; the second pick with a frame wins', async () => {
    const dark = scripted(BLACK, 'Dark window');
    const slides = scripted(lit(), 'Slides');
    const d = deps({
      picks: [{ kind: 'desktop', source: DARK }, { kind: 'desktop', source: SLIDES }],
      opens: { [DARK.id]: dark, [SLIDES.id]: slides },
    });
    const prepared = prepareScreenContext('electron', { legs: ['speaker'] }, d);
    await run(d.clock, 5000);
    await prepared;
    expect(d.pick.mock.calls).toEqual([[undefined], ['nothingVisible']]);
    expect(dark.close).toHaveBeenCalledTimes(1);
    expect(slides.close).not.toHaveBeenCalled();
    expect(store().sampler!.source.name).toBe('Slides');
    expect(store().state).toMatchObject({ status: 'live', name: 'Slides', sent: 1 });
    // The blank area's sampler went with it: nothing grabs it any more.
    const grabs = dark.grabs;
    await run(d.clock, 3000);
    expect(dark.grabs).toBe(grabs);
  });

  it('a cancel after a blank pick starts without frames', async () => {
    const dark = scripted(BLACK, 'Dark window');
    const d = deps({ picks: [{ kind: 'desktop', source: DARK }, null], opens: { [DARK.id]: dark } });
    const prepared = prepareScreenContext('electron', { legs: ['speaker'] }, d);
    await run(d.clock, 4000);
    await prepared;
    expect(d.pick.mock.calls).toEqual([[undefined], ['nothingVisible']]);
    expect(store().sampler).toBeNull();
    expect(store().state).toBeNull();
    expect(dark.close).toHaveBeenCalledTimes(1);
    // The capture and its sampler are both gone: no timer left armed.
    expect(d.clock.pending()).toBe(0);
  });

  it("a portal pick captures the one source the portal's listing returns", async () => {
    const slides = scripted(lit(), 'Slides');
    const invoke = vi.fn(async (channel: string) => (channel === 'list-capture-sources' ? { ok: true, sources: [SLIDES] } : undefined));
    const d = deps({ picks: [{ kind: 'portal' }], opens: { [SLIDES.id]: slides }, invoke });
    const prepared = prepareScreenContext('electron', { legs: ['speaker'] }, d);
    await run(d.clock, 1000);
    await prepared;
    expect(invoke).toHaveBeenCalledWith('list-capture-sources');
    expect(d.openDesktop).toHaveBeenCalledWith(SLIDES);
    expect(store().sampler!.source.name).toBe('Slides');
  });

  it('a portal that returns nothing, or a capture that will not open, starts without frames and never throws', async () => {
    // The portal's own Cancel: the user's answer, nothing to warn about.
    const cancelled = deps({ picks: [{ kind: 'portal' }], invoke: vi.fn(async () => ({ ok: true, sources: [] })) });
    await prepareScreenContext('electron', { legs: ['speaker'] }, cancelled);
    expect(cancelled.openDesktop).not.toHaveBeenCalled();
    expect(store().sampler).toBeNull();
    expect(reportWarning).not.toHaveBeenCalled();

    const refused = deps({ picks: [{ kind: 'portal' }], invoke: vi.fn(async () => ({ ok: false, error: 'screen-recording-denied' })) });
    await prepareScreenContext('electron', { legs: ['speaker'] }, refused);
    expect(refused.openDesktop).not.toHaveBeenCalled();
    expect(store().sampler).toBeNull();
    expect(reportWarning).toHaveBeenLastCalledWith('ScreenContext', expect.stringContaining('screen-recording-denied'));

    const failing = deps({ picks: [{ kind: 'desktop', source: SLIDES }] });
    await expect(prepareScreenContext('electron', { legs: ['speaker'] }, failing)).resolves.toBeUndefined();
    expect(failing.openDesktop).toHaveBeenCalledTimes(1);
    expect(store().sampler).toBeNull();
    expect(reportWarning).toHaveBeenLastCalledWith('ScreenContext', expect.stringContaining('no capture for window:1'), expect.objectContaining({ cause: expect.any(Error) }));
  });

  it('asks nothing on the web', async () => {
    const d = deps({ picks: [{ kind: 'desktop', source: SLIDES }] });
    await prepareScreenContext('web', { legs: ['speaker'] }, d);
    expect(d.pick).not.toHaveBeenCalled();
    expect(d.openTab).not.toHaveBeenCalled();
    expect(store().sampler).toBeNull();
  });
});

// ---- the extension ----------------------------------------------------------------------------

describe('prepareScreenContext — the extension', () => {
  /** The side panel opened for tab 42; `openTab` hands back `tab` and keeps the deps it was given. */
  function extension(tab: Scripted) {
    window.history.replaceState(null, '', '/?tabId=42');
    const d = deps();
    let given: TabCaptureDeps | null = null;
    d.openTab.mockImplementation(async (_tabId, tabDeps) => {
      given = tabDeps;
      await tabDeps.openStream();
      return tab;
    });
    return { d, given: () => given! };
  }

  it('on the extension opens the tab with audio only when a participant leg runs', async () => {
    for (const [legs, audio] of [[['speaker'], false], [['speaker', 'participant'], true], [['participant'], true]] as const) {
      const tab = scripted(lit(), 'Weekly sync', 'tab');
      const { d } = extension(tab);
      const prepared = prepareScreenContext('extension', { legs }, d);
      await run(d.clock, 1000);
      await prepared;
      expect(d.pick).not.toHaveBeenCalled();
      expect(d.openTab).toHaveBeenCalledWith(42, expect.anything());
      expect(openTabStream).toHaveBeenLastCalledWith(42, { audio, video: true }, tabStream.deps);
      expect(store().state).toMatchObject({ status: 'live', name: 'Weekly sync', kind: 'tab' });
      // Per run: the run's end releases the capture, and the stream with it.
      releaseScreenContext();
      expect(tab.close).toHaveBeenCalledTimes(1);
    }
  });

  it('a tab that shows nothing is released and the run starts without; the picker is never asked', async () => {
    const tab = scripted(BLACK, 'Weekly sync', 'tab');
    const { d } = extension(tab);
    const prepared = prepareScreenContext('extension', { legs: ['speaker'] }, d);
    await run(d.clock, 4000);
    await prepared;
    expect(d.pick).not.toHaveBeenCalled();
    expect(d.openTab).toHaveBeenCalledTimes(1);
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(store().sampler).toBeNull();
    expect(d.clock.pending()).toBe(0);
    expect(reportWarning).toHaveBeenCalledWith('ScreenContext', expect.stringContaining('showed nothing'));
  });

  it('without a targeted tab opens nothing', async () => {
    const d = deps();
    await prepareScreenContext('extension', { legs: ['speaker'] }, d);
    expect(d.openTab).not.toHaveBeenCalled();
    expect(store().sampler).toBeNull();
    expect(reportWarning).toHaveBeenCalledWith('ScreenContext', expect.stringContaining('No meeting tab'));
  });

  it("asks the tab for its shared screen and always settles: the answer, or null on an error, a non-object or silence past 2 s", async () => {
    const tab = scripted(lit(), 'Weekly sync', 'tab');
    const { d, given } = extension(tab);
    const prepared = prepareScreenContext('extension', { legs: ['speaker'] }, d);
    await run(d.clock, 1000);
    await prepared;

    const answer = { box: { x: 0, y: 0, width: 100, height: 50 }, viewport: { width: 200, height: 100 } };
    const runtime: { lastError?: { message: string } } = {};
    let reply: ((callback: (answer: unknown) => void) => void) = (callback) => callback(answer);
    const sendMessage = vi.fn((_tabId: number, _message: unknown, callback: (answer: unknown) => void) => reply(callback));
    vi.stubGlobal('chrome', { runtime, tabs: { sendMessage, get: vi.fn() } });

    await expect(given().askBox()).resolves.toEqual(answer);
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'SCREEN_CONTEXT_BBOX' }, expect.any(Function));

    reply = (callback) => { runtime.lastError = { message: 'Could not establish connection.' }; callback(undefined); runtime.lastError = undefined; };
    await expect(given().askBox()).resolves.toBeNull();

    reply = (callback) => callback('yes');
    await expect(given().askBox()).resolves.toBeNull();

    reply = () => {};
    let settled: unknown = 'pending';
    void given().askBox().then((value) => { settled = value; });
    d.clock.advance(1999);
    await flush();
    expect(settled).toBe('pending');
    d.clock.advance(1);
    await flush();
    expect(settled).toBeNull();

    vi.stubGlobal('chrome', undefined);
    await expect(given().askBox()).resolves.toBeNull();
  });

  it("names the capture by the tab's title, or 'Meeting tab'", async () => {
    const tab = scripted(lit(), 'Weekly sync', 'tab');
    const { d, given } = extension(tab);
    const prepared = prepareScreenContext('extension', { legs: ['speaker'] }, d);
    await run(d.clock, 1000);
    await prepared;

    let found: { title?: string } | undefined = { title: 'Weekly sync - Google Meet' };
    const runtime: { lastError?: { message: string } } = {};
    vi.stubGlobal('chrome', { runtime, tabs: { sendMessage: vi.fn(), get: vi.fn((_id: number, callback: (tab?: unknown) => void) => callback(found)) } });
    await expect(given().tabTitle()).resolves.toBe('Weekly sync - Google Meet');
    found = {};
    await expect(given().tabTitle()).resolves.toBe('Meeting tab');
    found = undefined;
    await expect(given().tabTitle()).resolves.toBe('Meeting tab');
    vi.stubGlobal('chrome', undefined);
    await expect(given().tabTitle()).resolves.toBe('Meeting tab');
  });
});

// ---- the run's end, and Choose again ----------------------------------------------------------

describe('releaseScreenContext and chooseAgain', () => {
  it('releaseScreenContext closes the sampler and empties the store; chooseAgain swaps the capture under the same source', async () => {
    const slides = scripted(lit(1), 'Slides');
    const notes = scripted(lit(4), 'Notes');
    const d = deps({ picks: [{ kind: 'desktop', source: SLIDES }, { kind: 'desktop', source: NOTES }], opens: { [SLIDES.id]: slides, [NOTES.id]: notes } });
    const prepared = prepareScreenContext('electron', { legs: ['speaker', 'participant'] }, d);
    await run(d.clock, 1000);
    await prepared;
    const sampler = store().sampler!;
    const heard: string[] = [];
    // Both legs' subscriptions, as a Both run holds them.
    sampler.source.subscribe((_jpeg, reason) => heard.push(`speaker:${reason}`), () => heard.push('speaker:lost'), () => heard.push('speaker:back'));
    sampler.source.subscribe((_jpeg, reason) => heard.push(`participant:${reason}`), () => heard.push('participant:lost'), () => heard.push('participant:back'));
    heard.length = 0;

    await chooseAgain(d);
    expect(d.pick.mock.calls).toEqual([[undefined], []]);
    expect(slides.close).toHaveBeenCalledTimes(1);
    expect(store().sampler).toBe(sampler);
    await run(d.clock, 1000);
    expect(sampler.source.name).toBe('Notes');
    expect(store().state).toMatchObject({ status: 'live', name: 'Notes', sent: 2, lastReason: 'changed' });
    // The same subscriptions hear the new area; no loss is told for a swap.
    expect(heard).toEqual(['speaker:changed', 'participant:changed']);

    releaseScreenContext();
    expect(notes.close).toHaveBeenCalledTimes(1);
    expect(store().sampler).toBeNull();
    expect(store().state).toBeNull();
    expect(d.clock.pending()).toBe(0);
    const grabs = notes.grabs;
    await run(d.clock, 3000);
    expect(notes.grabs).toBe(grabs);
  });

  it('a cancelled Choose again keeps the capture; one that will not open keeps it too', async () => {
    const slides = scripted(lit(), 'Slides');
    const d = deps({ picks: [{ kind: 'desktop', source: SLIDES }, null, { kind: 'desktop', source: NOTES }], opens: { [SLIDES.id]: slides } });
    const prepared = prepareScreenContext('electron', { legs: ['speaker'] }, d);
    await run(d.clock, 1000);
    await prepared;
    await chooseAgain(d);
    await chooseAgain(d);
    expect(d.openDesktop).toHaveBeenCalledTimes(2);
    expect(slides.close).not.toHaveBeenCalled();
    expect(store().state).toMatchObject({ status: 'live', name: 'Slides' });
    expect(reportWarning).toHaveBeenCalledTimes(1);
    expect(reportWarning).toHaveBeenCalledWith('ScreenContext', expect.stringContaining('no capture for window:3'), expect.anything());
  });

  it('a Choose again answered after the run ended opens nothing; one still opening when it ended closes what it opened', async () => {
    const slides = scripted(lit(), 'Slides');
    const notes = scripted(lit(4), 'Notes');
    const d = deps({ picks: [{ kind: 'desktop', source: SLIDES }], opens: { [SLIDES.id]: slides, [NOTES.id]: notes } });
    const prepared = prepareScreenContext('electron', { legs: ['speaker'] }, d);
    await run(d.clock, 1000);
    await prepared;
    let answer: (picked: PickedSource | null) => void = () => {};
    d.pick.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const choosing = chooseAgain(d);
    releaseScreenContext();
    answer({ kind: 'desktop', source: NOTES });
    await choosing;
    expect(d.openDesktop).toHaveBeenCalledTimes(1);
    expect(store().sampler).toBeNull();

    // A second run, and a Choose again whose capture opens after that run has ended.
    const again = deps({ picks: [{ kind: 'desktop', source: SLIDES }, { kind: 'desktop', source: NOTES }], opens: { [SLIDES.id]: scripted(lit(), 'Slides') } });
    const preparedAgain = prepareScreenContext('electron', { legs: ['speaker'] }, again);
    await run(again.clock, 1000);
    await preparedAgain;
    let opened: (capture: Scripted) => void = () => {};
    again.openDesktop.mockImplementationOnce(() => new Promise((resolve) => { opened = resolve; }));
    const late = chooseAgain(again);
    await flush();
    releaseScreenContext();
    opened(notes);
    await late;
    expect(notes.close).toHaveBeenCalledTimes(1);
    expect(store().sampler).toBeNull();
  });

  it('chooseAgain without a run does nothing', async () => {
    const d = deps({ picks: [{ kind: 'desktop', source: SLIDES }] });
    await chooseAgain(d);
    expect(d.pick).not.toHaveBeenCalled();
  });
});
