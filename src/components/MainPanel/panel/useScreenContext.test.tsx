import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const env = vi.hoisted(() => ({ electron: true }));
vi.mock('../../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/environment')>()),
  isElectron: () => env.electron,
}));

// Choose again's own rules are screenContext.test.ts's; this file checks what the panel hands it.
const chooseAgain = vi.hoisted(() => vi.fn(async (_deps: unknown) => {}));
vi.mock('../../../app/screenContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../app/screenContext')>()),
  chooseAgain,
}));

// Seen, and kept off the console.
const reportWarning = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/diagnostics/report')>()),
  reportWarning,
}));

import type { PickedSource, PickReason } from '../../../app/screenContext';
import type { CaptureSourceInfo } from '../../../lib/screen/desktopFrames';
import { openDesktopCapture } from '../../../lib/screen/desktopFrames';
import type { Sampler, SamplerState } from '../../../lib/screen/sampler';
import { useScreenContextStore } from '../../../stores/screenContextStore';
import { useScreenContext } from './useScreenContext';

const SLIDES: CaptureSourceInfo = { id: 'window:1', name: 'Slides', kind: 'window', thumbnail: 'data:,a', appIcon: null };
const DESKTOP: CaptureSourceInfo = { id: 'screen:0', name: 'Entire screen', kind: 'screen', thumbnail: 'data:,b', appIcon: null };

type Mode = { mode: 'list' | 'portal'; screenRecording: string };
type Listed = { ok: true; sources: CaptureSourceInfo[] } | { ok: false; error: string };

/** The main process as the picker asks it: `modes` answers each capture-source-mode in turn (the last one repeats). */
function ipc(o: { modes?: Mode[]; listed?: Listed | Error } = {}) {
  const modes = [...(o.modes ?? [{ mode: 'list', screenRecording: 'granted' }])];
  const channels: string[] = [];
  const invoke = vi.fn(async (channel: string, _data?: unknown) => {
    channels.push(channel);
    if (channel === 'capture-source-mode') return modes.length > 1 ? modes.shift() : modes[0];
    if (channel === 'list-capture-sources') {
      if (o.listed instanceof Error) throw o.listed;
      return o.listed ?? { ok: true, sources: [SLIDES, DESKTOP] };
    }
    return { ok: true };
  });
  vi.stubGlobal('electron', { invoke });
  return { invoke, channels };
}

const session = { setBridges: vi.fn() };

/** The picker the hook last handed the session. */
function bridge(): (reason?: PickReason) => Promise<PickedSource | null> {
  const calls = session.setBridges.mock.calls.map(([next]) => next as { pickScreenSource?: unknown });
  const last = [...calls].reverse().find((next) => 'pickScreenSource' in next);
  if (typeof last?.pickScreenSource !== 'function') throw new Error('no picker registered');
  return last.pickScreenSource as (reason?: PickReason) => Promise<PickedSource | null>;
}

async function flush(): Promise<void> {
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
}

/** Opens the picker through the session's bridge and lets its IPC answer; `answer` settles with the pick. */
async function openPicker(reason?: PickReason): Promise<{ answer: Promise<PickedSource | null> }> {
  let answer!: Promise<PickedSource | null>;
  act(() => { answer = bridge()(reason); });
  await flush();
  // Wrapped: an async function would adopt the pick's promise and wait for it.
  return { answer };
}

const state = (over: Partial<SamplerState> = {}): SamplerState => ({
  status: 'live', name: 'Slides', kind: 'window', sent: 3, lastSentAt: 1_000, lastReason: 'changed', lastJpeg: null, ...over,
});
const SAMPLER = {} as Sampler;

beforeEach(() => {
  env.electron = true;
  session.setBridges.mockClear();
  chooseAgain.mockClear();
  reportWarning.mockClear();
  useScreenContextStore.setState({ sampler: null, state: null, preparing: false, picked: null, pickSource: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useScreenContext — the picker bridge', () => {
  it('opens with the windows the desktop lists, re-reads the permission after the listing, and answers with the one picked', async () => {
    const { channels } = ipc();
    const { result } = renderHook(() => useScreenContext(session));
    expect(result.current.picker.open).toBe(false);

    let answer!: Promise<PickedSource | null>;
    act(() => { answer = bridge()(); });
    // Loading until the desktop answers.
    expect(result.current.picker).toMatchObject({ open: true, sources: null, purpose: 'start' });
    await flush();
    expect(result.current.picker).toMatchObject({ open: true, mode: 'list', screenRecording: 'granted', sources: [SLIDES, DESKTOP] });
    expect(channels).toEqual(['capture-source-mode', 'list-capture-sources', 'capture-source-mode']);

    act(() => { result.current.picker.onPick(SLIDES); });
    await expect(answer).resolves.toEqual({ kind: 'desktop', source: SLIDES });
    expect(result.current.picker.open).toBe(false);
  });

  it('passes the reason on, and a cancel answers null', async () => {
    ipc();
    const { result } = renderHook(() => useScreenContext(session));
    const { answer } = await openPicker('nothingVisible');
    expect(result.current.picker.reason).toBe('nothingVisible');
    act(() => { result.current.picker.onCancel(); });
    await expect(answer).resolves.toBeNull();
    expect(result.current.picker.open).toBe(false);
  });

  it('Refresh asks the desktop again while the picker is open — the list stays up meanwhile — and the pick keeps waiting', async () => {
    ipc();
    const { result } = renderHook(() => useScreenContext(session));
    const { answer } = await openPicker();
    expect(result.current.picker).toMatchObject({ sources: [SLIDES, DESKTOP], refreshing: false });

    // A window closed meanwhile: the desktop now lists the screen alone. The old list is not torn down while it answers.
    const { channels } = ipc({ listed: { ok: true, sources: [DESKTOP] } });
    act(() => { result.current.picker.onRefresh(); });
    expect(result.current.picker).toMatchObject({ open: true, sources: [SLIDES, DESKTOP], refreshing: true });
    await flush();
    expect(result.current.picker).toMatchObject({ open: true, mode: 'list', sources: [DESKTOP], refreshing: false });
    expect(channels).toEqual(['capture-source-mode', 'list-capture-sources', 'capture-source-mode']);

    act(() => { result.current.picker.onPick(DESKTOP); });
    await expect(answer).resolves.toEqual({ kind: 'desktop', source: DESKTOP });
  });

  it('a Refresh once the picker has closed asks nothing', async () => {
    ipc();
    const { result } = renderHook(() => useScreenContext(session));
    const { answer } = await openPicker();
    act(() => { result.current.picker.onCancel(); });
    await expect(answer).resolves.toBeNull();
    const { invoke } = ipc();
    act(() => { result.current.picker.onRefresh(); });
    await flush();
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.picker.open).toBe(false);
  });

  it('on a portal desktop lists nothing, and its one button answers portal', async () => {
    const { channels } = ipc({ modes: [{ mode: 'portal', screenRecording: 'granted' }] });
    const { result } = renderHook(() => useScreenContext(session));
    const { answer } = await openPicker();
    // The listing is what opens the portal's own dialog: it waits for the button.
    expect(channels).toEqual(['capture-source-mode']);
    expect(result.current.picker).toMatchObject({ open: true, mode: 'portal' });
    act(() => { result.current.picker.onPortal(); });
    await expect(answer).resolves.toEqual({ kind: 'portal' });
  });

  it('shows the denied state when the listing is refused, and opens the Screen Recording pane', async () => {
    const { invoke } = ipc({ listed: { ok: false, error: 'screen-recording-denied' } });
    const { result } = renderHook(() => useScreenContext(session));
    await openPicker();
    expect(result.current.picker).toMatchObject({ open: true, screenRecording: 'denied', sources: [] });
    act(() => { result.current.picker.onOpenPrivacy(); });
    expect(invoke).toHaveBeenCalledWith('open-privacy-settings', 'screen-recording');
  });

  it('shows the denied state when the status reads denied after a first listing on a Mac never asked', async () => {
    ipc({ modes: [{ mode: 'list', screenRecording: 'not-determined' }, { mode: 'list', screenRecording: 'denied' }], listed: { ok: true, sources: [SLIDES] } });
    const { result } = renderHook(() => useScreenContext(session));
    await openPicker();
    expect(result.current.picker).toMatchObject({ screenRecording: 'denied', sources: [] });
  });

  it('a listing that fails otherwise, or an IPC that rejects, shows nothing found and says why in the logs', async () => {
    ipc({ listed: { ok: false, error: 'getSources failed' } });
    const { result, unmount } = renderHook(() => useScreenContext(session));
    await openPicker();
    expect(result.current.picker).toMatchObject({ open: true, screenRecording: 'granted', sources: [] });
    expect(reportWarning).toHaveBeenLastCalledWith('ScreenContext', expect.stringContaining('getSources failed'));
    unmount();

    ipc({ listed: new Error('no handler') });
    const second = renderHook(() => useScreenContext(session));
    await openPicker();
    expect(second.result.current.picker).toMatchObject({ open: true, sources: [] });
    expect(reportWarning).toHaveBeenLastCalledWith('ScreenContext', expect.stringContaining('no handler'), expect.objectContaining({ cause: expect.any(Error) }));
  });

  it('always settles: an unmount answers the open pick with null and takes the picker away', async () => {
    ipc();
    const { unmount } = renderHook(() => useScreenContext(session));
    const { answer } = await openPicker();
    unmount();
    await expect(answer).resolves.toBeNull();
    expect(session.setBridges).toHaveBeenLastCalledWith({ pickScreenSource: null });
  });

  it('a second pick while one is open answers the first with null', async () => {
    ipc();
    const { result } = renderHook(() => useScreenContext(session));
    const { answer: first } = await openPicker();
    const { answer: second } = await openPicker();
    await expect(first).resolves.toBeNull();
    expect(result.current.picker.open).toBe(true);
    act(() => { result.current.picker.onPick(DESKTOP); });
    await expect(second).resolves.toEqual({ kind: 'desktop', source: DESKTOP });
  });

  it('registers nothing off the desktop, where only the meeting tab is captured', () => {
    env.electron = false;
    const { result } = renderHook(() => useScreenContext(session));
    expect(session.setBridges).not.toHaveBeenCalled();
    expect(useScreenContextStore.getState().pickSource).toBeNull();
    act(() => { useScreenContextStore.setState({ sampler: SAMPLER, state: state(), preparing: true }); });
    // The tab's first frame is awaited: Start shows it, no modal does.
    expect(result.current.preparing).toBe(true);
    expect(result.current.picker.open).toBe(false);
    expect(result.current.chip?.onChooseAgain).toBeUndefined();
  });
});

describe('useScreenContext — the picker for the settings (owner, 2026-10-22, ruling 1)', () => {
  it('registers the picker in the store, asking for the settings, whose Cancel says Cancel; an unmount answers null and takes it away', async () => {
    ipc();
    const { result, unmount } = renderHook(() => useScreenContext(session));
    const pickSource = useScreenContextStore.getState().pickSource;
    expect(pickSource).toBeTypeOf('function');

    let answer!: Promise<PickedSource | null>;
    act(() => { answer = pickSource!(); });
    await flush();
    expect(result.current.picker).toMatchObject({ open: true, purpose: 'settings', sources: [SLIDES, DESKTOP] });
    act(() => { result.current.picker.onPick(SLIDES); });
    await expect(answer).resolves.toEqual({ kind: 'desktop', source: SLIDES });
    expect(result.current.picker.open).toBe(false);

    act(() => { answer = pickSource!(); });
    await flush();
    unmount();
    await expect(answer).resolves.toBeNull();
    expect(useScreenContextStore.getState().pickSource).toBeNull();
  });
});

describe('useScreenContext — checking the pick', () => {
  it('keeps the picker up, checking, from the pick until the first frame settles, with nothing to cancel', async () => {
    ipc();
    const { result } = renderHook(() => useScreenContext(session));
    const { answer } = await openPicker();
    act(() => { result.current.picker.onPick(SLIDES); });
    await expect(answer).resolves.toEqual({ kind: 'desktop', source: SLIDES });
    act(() => { useScreenContextStore.setState({ preparing: true }); });
    expect(result.current.preparing).toBe(true);
    expect(result.current.picker).toMatchObject({ open: true, checking: true });
    // Nothing to cancel: the pick has been answered.
    act(() => { result.current.picker.onCancel(); });
    expect(result.current.picker.open).toBe(true);
    act(() => { useScreenContextStore.setState({ preparing: false }); });
    expect(result.current.picker.open).toBe(false);
  });

  it('shows no picker while Start checks the area held from before: nothing was asked (owner, 2026-10-22, ruling 2)', async () => {
    ipc();
    const { result } = renderHook(() => useScreenContext(session));
    act(() => { useScreenContextStore.setState({ preparing: true }); });
    // Start shows the check; the modal stays shut.
    expect(result.current.preparing).toBe(true);
    expect(result.current.picker.open).toBe(false);
    act(() => { useScreenContextStore.setState({ preparing: false }); });

    // A pick made in the settings is not checked there: a later Start's check of it shows no picker either.
    const { answer } = await (async () => {
      let pending!: Promise<PickedSource | null>;
      act(() => { pending = useScreenContextStore.getState().pickSource!(); });
      await flush();
      return { answer: pending };
    })();
    act(() => { result.current.picker.onPick(SLIDES); });
    await expect(answer).resolves.toEqual({ kind: 'desktop', source: SLIDES });
    act(() => { useScreenContextStore.setState({ preparing: true }); });
    expect(result.current.picker.open).toBe(false);
    act(() => { useScreenContextStore.setState({ preparing: false }); });

    // A Start-time pick is checked in the picker, once: the next Start's check of the held pick shows none.
    const start = await openPicker('gone');
    act(() => { result.current.picker.onPick(DESKTOP); });
    await expect(start.answer).resolves.toEqual({ kind: 'desktop', source: DESKTOP });
    act(() => { useScreenContextStore.setState({ preparing: true }); });
    expect(result.current.picker).toMatchObject({ open: true, checking: true });
    act(() => { useScreenContextStore.setState({ preparing: false }); });
    expect(result.current.picker.open).toBe(false);
    act(() => { useScreenContextStore.setState({ preparing: true }); });
    expect(result.current.picker.open).toBe(false);
  });
});

describe('useScreenContext — the chip', () => {
  it('none without a sampler or while idle; otherwise the state, with a Choose again on the desktop', () => {
    ipc();
    const { result } = renderHook(() => useScreenContext(session));
    expect(result.current.chip).toBeNull();
    act(() => { useScreenContextStore.setState({ sampler: null, state: state() }); });
    expect(result.current.chip).toBeNull();
    act(() => { useScreenContextStore.setState({ sampler: SAMPLER, state: state({ status: 'idle' }) }); });
    expect(result.current.chip).toBeNull();
    act(() => { useScreenContextStore.setState({ sampler: SAMPLER, state: state({ status: 'stale', sent: 7, lastSentAt: 4_000 }) }); });
    expect(result.current.chip).toMatchObject({ name: 'Slides', kind: 'window', status: 'stale', sentCount: 7, lastSentAt: 4_000, thumbnail: null });
    expect(typeof result.current.chip?.now).toBe('number');
    expect(result.current.chip?.onChooseAgain).toBeTypeOf('function');
  });

  it('makes one object URL per frame for the thumbnail, revokes the one before, and the last on unmount', async () => {
    let n = 0;
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); n += 1; return `blob:frame-${n}`; });
    const revokeObjectURL = vi.fn();
    // jsdom has neither.
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    try {
      ipc();
      const { result, unmount } = renderHook(() => useScreenContext(session));
      const first = new Uint8Array([0xff, 0xd8, 1]);
      act(() => { useScreenContextStore.setState({ sampler: SAMPLER, state: state({ lastJpeg: first }) }); });
      expect(result.current.chip?.thumbnail).toBe('blob:frame-1');
      expect(blobs[0].type).toBe('image/jpeg');
      expect(blobs[0].size).toBe(3);

      // A new state with the same frame (a status change): the same URL.
      act(() => { useScreenContextStore.setState({ state: state({ status: 'stale', lastJpeg: first }) }); });
      expect(createObjectURL).toHaveBeenCalledTimes(1);

      act(() => { useScreenContextStore.setState({ state: state({ lastJpeg: new Uint8Array([0xff, 0xd8, 2]) }) }); });
      expect(result.current.chip?.thumbnail).toBe('blob:frame-2');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:frame-1');

      unmount();
      expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:frame-2');
    } finally {
      Object.assign(URL, original);
    }
  });

  it('Choose again opens the picker for the running session, whose Cancel keeps the source', async () => {
    const { invoke } = ipc();
    const { result } = renderHook(() => useScreenContext(session));
    act(() => { useScreenContextStore.setState({ sampler: SAMPLER, state: state() }); });
    act(() => { result.current.chip!.onChooseAgain!(); });
    expect(chooseAgain).toHaveBeenCalledTimes(1);
    const deps = chooseAgain.mock.calls[0][0] as { pick(reason?: PickReason): Promise<PickedSource | null>; invoke(channel: string): Promise<unknown>; openDesktop: unknown };
    expect(deps.openDesktop).toBe(openDesktopCapture);
    await deps.invoke('capture-source-mode');
    expect(invoke).toHaveBeenCalledWith('capture-source-mode', undefined);

    let answer!: Promise<PickedSource | null>;
    act(() => { answer = deps.pick(); });
    await flush();
    expect(result.current.picker).toMatchObject({ open: true, purpose: 'choose-again' });
    act(() => { result.current.picker.onCancel(); });
    await expect(answer).resolves.toBeNull();
  });
});
