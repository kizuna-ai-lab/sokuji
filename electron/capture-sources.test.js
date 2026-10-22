import { describe, it, expect, vi } from 'vitest';
import { pickableSources, captureSourceMode, listCaptureSources } from './capture-sources.js';

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
  it('is the portal on a Wayland session and the list everywhere else', () => {
    expect(captureSourceMode('linux', { XDG_SESSION_TYPE: 'wayland' })).toBe('portal');
    expect(captureSourceMode('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe('portal');
    expect(captureSourceMode('linux', { XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' })).toBe('list');
    expect(captureSourceMode('darwin', {})).toBe('list');
    expect(captureSourceMode('win32', {})).toBe('list');
  });

  it('is the list off Linux even when the session variables say Wayland', () => {
    expect(captureSourceMode('darwin', { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' })).toBe('list');
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

  it('turns a throw that is not an Error into its text', async () => {
    const out = await listCaptureSources({ screenRecording: () => 'granted', getSources: async () => { throw 'portal closed'; }, ownIds: () => [] });
    expect(out).toEqual({ ok: false, error: 'portal closed' });
  });
});
