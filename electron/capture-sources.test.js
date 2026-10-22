import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pickableSources,
  captureSourceMode,
  listCaptureSources,
  screenRecordingState,
  reaskScreenRecording,
  REASK_WAIT_MS,
  MAC_BUNDLE_ID,
} from './capture-sources.js';

describe('pickableSources', () => {
  it('lists windows before screens, drops this app\'s own windows and nameless sources, and types by id prefix', () => {
    const out = pickableSources([
      { id: 'screen:0:0', name: 'Entire Screen', thumbnail: 'data:1', appIcon: null },
      { id: 'window:12:0', name: 'Slides — Keynote', thumbnail: 'data:2', appIcon: 'data:i' },
      { id: 'window:99:0', name: 'Sokuji', thumbnail: 'data:3', appIcon: null },
      { id: 'window:13:0', name: '', thumbnail: 'data:4', appIcon: null },
    ], ['window:99:0']);
    expect(out.map((s) => [s.id, s.kind])).toEqual([['window:12:0', 'window'], ['screen:0:0', 'screen']]);
  });

  it('keeps the thumbnail and the icon as they came, and the listed order within each kind', () => {
    const out = pickableSources([
      { id: 'window:2:0', name: 'B', thumbnail: 'data:b', appIcon: 'data:ib' },
      { id: 'screen:1:0', name: 'Screen 2', thumbnail: 'data:s2', appIcon: null },
      { id: 'window:1:0', name: 'A', thumbnail: 'data:a', appIcon: null },
      { id: 'screen:0:0', name: 'Screen 1', thumbnail: 'data:s1', appIcon: null },
    ], []);
    expect(out).toEqual([
      { id: 'window:2:0', name: 'B', kind: 'window', thumbnail: 'data:b', appIcon: 'data:ib' },
      { id: 'window:1:0', name: 'A', kind: 'window', thumbnail: 'data:a', appIcon: null },
      { id: 'screen:1:0', name: 'Screen 2', kind: 'screen', thumbnail: 'data:s2', appIcon: null },
      { id: 'screen:0:0', name: 'Screen 1', kind: 'screen', thumbnail: 'data:s1', appIcon: null },
    ]);
  });

  it('drops a source that is neither a window nor a screen, and a name of only whitespace', () => {
    const out = pickableSources([
      { id: 'tab:1:0', name: 'Not ours to list', thumbnail: 'data:1', appIcon: null },
      { id: 'window:5:0', name: '   ', thumbnail: 'data:2', appIcon: null },
      { id: 'window:6:0', name: 'Kept', thumbnail: 'data:3', appIcon: null },
    ], []);
    expect(out.map((s) => s.id)).toEqual(['window:6:0']);
  });
});

describe('captureSourceMode', () => {
  it("is the portal exactly when Chromium's capturer goes through it, and the list everywhere else", () => {
    // WebRTC's DesktopCapturer::IsRunningUnderWayland(): XDG_SESSION_TYPE starting "wayland" AND WAYLAND_DISPLAY set.
    // WebRTCPipeWireCapturer is on in every branch (linux-gpu-flags.js), and the Ozone platform plays no part, so the
    // .deb's --ozone-platform=x11 on a Wayland session still lists through the portal.
    expect(captureSourceMode('linux', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' })).toBe('portal');
    // WebRTC asks only whether WAYLAND_DISPLAY exists (getenv() is non-null for an empty value): set but empty is Wayland too.
    expect(captureSourceMode('linux', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: '' })).toBe('portal');
    // Either variable alone is what WebRTC calls X11: its listing is every window, never the portal's one pick.
    expect(captureSourceMode('linux', { XDG_SESSION_TYPE: 'wayland' })).toBe('list');
    expect(captureSourceMode('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe('list');
    expect(captureSourceMode('linux', { XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' })).toBe('list');
    expect(captureSourceMode('darwin', {})).toBe('list');
    expect(captureSourceMode('win32', {})).toBe('list');
  });

  it('is the list off Linux even when the session variables say Wayland', () => {
    expect(captureSourceMode('darwin', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' })).toBe('list');
  });
});

describe('screenRecordingState', () => {
  it("is granted off macOS without reading anything, macOS's own status otherwise, and restricted reads as denied", () => {
    const never = vi.fn(() => 'denied');
    expect(screenRecordingState('linux', never)).toBe('granted');
    expect(screenRecordingState('win32', never)).toBe('granted');
    expect(never).not.toHaveBeenCalled();
    // A profile or parental control forbids it: a refusal like denied, never a listing of blank windows.
    expect(screenRecordingState('darwin', () => 'restricted')).toBe('denied');
    expect(screenRecordingState('darwin', () => 'denied')).toBe('denied');
    expect(screenRecordingState('darwin', () => 'granted')).toBe('granted');
    // Not asked yet: the listing is what raises the system prompt, so it is let through.
    expect(screenRecordingState('darwin', () => 'not-determined')).toBe('not-determined');
  });
});

describe('listCaptureSources', () => {
  it('never asks for the sources while Screen Recording is denied, and passes a failed listing through as its message', async () => {
    const getSources = vi.fn(async () => []);
    expect(await listCaptureSources({ screenRecording: () => 'denied', getSources, ownIds: () => [] })).toEqual({ ok: false, error: 'screen-recording-denied' });
    expect(getSources).not.toHaveBeenCalled();
    expect(await listCaptureSources({ screenRecording: () => 'granted', getSources: async () => { throw new Error('no portal'); }, ownIds: () => [] })).toEqual({ ok: false, error: 'no portal' });
  });

  it('asks for the sources while the status is not-determined, which is what raises the macOS prompt', async () => {
    const getSources = vi.fn(async () => [{ id: 'screen:0:0', name: 'Entire Screen', thumbnail: 'data:1', appIcon: null }]);
    const out = await listCaptureSources({ screenRecording: () => 'not-determined', getSources, ownIds: () => [] });
    expect(getSources).toHaveBeenCalledOnce();
    expect(out).toEqual({ ok: true, sources: [{ id: 'screen:0:0', name: 'Entire Screen', kind: 'screen', thumbnail: 'data:1', appIcon: null }] });
  });

  it('filters the listing with the own ids read after the listing, and answers the pickable sources', async () => {
    const order = [];
    const out = await listCaptureSources({
      screenRecording: () => 'granted',
      getSources: async () => {
        order.push('list');
        return [
          { id: 'window:1:0', name: 'Sokuji', thumbnail: 'data:1', appIcon: null },
          { id: 'window:2:0', name: 'Slides', thumbnail: 'data:2', appIcon: null },
        ];
      },
      ownIds: () => { order.push('own'); return ['window:1:0']; },
    });
    expect(out).toEqual({ ok: true, sources: [{ id: 'window:2:0', name: 'Slides', kind: 'window', thumbnail: 'data:2', appIcon: null }] });
    expect(order).toEqual(['list', 'own']);
  });

  it('answers a status that cannot be read as a failed listing, asking for nothing', async () => {
    const getSources = vi.fn(async () => []);
    const out = await listCaptureSources({
      screenRecording: () => { throw new Error('no such media type'); },
      getSources,
      ownIds: () => [],
    });
    expect(out).toEqual({ ok: false, error: 'no such media type' });
    expect(getSources).not.toHaveBeenCalled();
  });

  it("in portal mode keeps the one pick the portal returned though it has no name, named 'Shared screen'; the list mode drops it", async () => {
    const nameless = async () => [{ id: 'window:7:0', name: '', thumbnail: 'data:7', appIcon: null }];
    expect(await listCaptureSources({ mode: 'portal', screenRecording: () => 'granted', getSources: nameless, ownIds: () => [] }))
      .toEqual({ ok: true, sources: [{ id: 'window:7:0', name: 'Shared screen', kind: 'window', thumbnail: 'data:7', appIcon: null }] });
    const blank = async () => [{ id: 'screen:1:0', name: '  ', thumbnail: 'data:1', appIcon: null }];
    expect(await listCaptureSources({ mode: 'portal', screenRecording: () => 'granted', getSources: blank, ownIds: () => [] }))
      .toEqual({ ok: true, sources: [{ id: 'screen:1:0', name: 'Shared screen', kind: 'screen', thumbnail: 'data:1', appIcon: null }] });
    const named = async () => [{ id: 'window:8:0', name: 'Slides', thumbnail: 'data:8', appIcon: null }];
    expect(await listCaptureSources({ mode: 'portal', screenRecording: () => 'granted', getSources: named, ownIds: () => [] }))
      .toEqual({ ok: true, sources: [{ id: 'window:8:0', name: 'Slides', kind: 'window', thumbnail: 'data:8', appIcon: null }] });
    expect(await listCaptureSources({ mode: 'list', screenRecording: () => 'granted', getSources: nameless, ownIds: () => [] }))
      .toEqual({ ok: true, sources: [] });
  });

  it('turns a throw that is not an Error into its text', async () => {
    const out = await listCaptureSources({ screenRecording: () => 'granted', getSources: async () => { throw 'portal closed'; }, ownIds: () => [] });
    expect(out).toEqual({ ok: false, error: 'portal closed' });
  });
});

describe('reaskScreenRecording', () => {
  /** A Mac whose permission reads denied; the listing answers at once and the wait never ends. */
  const mac = (over = {}) => {
    const order = [];
    const deps = {
      platform: 'darwin',
      screenRecording: vi.fn(() => 'denied'),
      reset: vi.fn(async () => { order.push('reset'); }),
      request: vi.fn(async () => { order.push('request'); return []; }),
      wait: vi.fn(() => new Promise(() => {})),
      ...over,
    };
    return { deps, order };
  };

  it("resets Sokuji's own entry first, then asks for the window list once, which raises macOS's prompt, and answers the status read after", async () => {
    const { deps, order } = mac();
    await expect(reaskScreenRecording(deps)).resolves.toEqual({ asked: true, status: 'denied' });
    expect(order).toEqual(['reset', 'request']);
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('leaves a permission that already works alone, and asks nothing off macOS', async () => {
    const granted = mac({ screenRecording: vi.fn(() => 'granted') });
    await expect(reaskScreenRecording(granted.deps)).resolves.toEqual({ asked: false, status: 'granted' });
    expect(granted.deps.reset).not.toHaveBeenCalled();
    expect(granted.deps.request).not.toHaveBeenCalled();

    const linux = mac({ platform: 'linux', screenRecording: vi.fn(() => 'granted') });
    await expect(reaskScreenRecording(linux.deps)).resolves.toEqual({ asked: false, status: 'granted' });
    expect(linux.deps.reset).not.toHaveBeenCalled();
  });

  it('a reset that fails still asks (a Mac never asked needs no reset), and says why', async () => {
    const { deps, order } = mac({ reset: vi.fn(async () => { throw new Error('tccutil exited with code 64'); }) });
    await expect(reaskScreenRecording(deps)).resolves.toEqual({ asked: true, status: 'denied', resetError: 'tccutil exited with code 64' });
    expect(deps.request).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['request']);
  });

  it(`a listing that never answers while the prompt is up is waited for ${REASK_WAIT_MS} ms at most, and one that fails still answers`, async () => {
    const hung = mac({ request: vi.fn(() => new Promise(() => {})), wait: vi.fn(async () => {}) });
    await expect(reaskScreenRecording(hung.deps)).resolves.toEqual({ asked: true, status: 'denied' });
    expect(hung.deps.wait).toHaveBeenCalledWith(REASK_WAIT_MS);

    const failed = mac({ request: vi.fn(async () => { throw new Error('no permission'); }) });
    await expect(reaskScreenRecording(failed.deps)).resolves.toEqual({ asked: true, status: 'denied' });
  });

  it("names the bundle the release is built as: the signing identity's, so the reset clears Sokuji's entry and no other", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    expect(MAC_BUNDLE_ID).toBe(pkg.build.appId);
  });
});

describe('main.js wiring for asking macOS again', () => {
  const main = readFileSync(join(__dirname, 'main.js'), 'utf8');

  it("resets with the system's tccutil, for Sokuji's bundle, and asks through desktopCapturer", () => {
    const at = main.indexOf("ipcMain.handle('reask-screen-recording'");
    expect(at).toBeGreaterThan(-1);
    const handler = main.slice(at, main.indexOf('\n});', at));
    expect(handler).toContain('reaskScreenRecording(');
    expect(handler).toMatch(/execFileAsync\('\/usr\/bin\/tccutil', \['reset', 'ScreenCapture', MAC_BUNDLE_ID\]\)/);
    expect(handler).toContain('desktopCapturer.getSources(');
  });

  it('restarts by relaunching and then quitting, so the close handshake still runs', () => {
    const at = main.indexOf("ipcMain.handle('relaunch-app'");
    expect(at).toBeGreaterThan(-1);
    const handler = main.slice(at, main.indexOf('\n});', at));
    expect(handler.indexOf('app.relaunch()')).toBeGreaterThan(-1);
    expect(handler.indexOf('app.relaunch()')).toBeLessThan(handler.indexOf('app.quit()'));
  });
});
