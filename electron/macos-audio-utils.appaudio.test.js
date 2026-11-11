// Per-application capture behaviour of the macOS platform module (issue #335).
//
// These inject a fake `host` rather than vi.mock'ing audio-host.js:
// macos-audio-utils.js is CommonJS and reaches it through require(), which
// vi.mock does not reliably intercept.
import { describe, it, expect, vi } from 'vitest';
import {
  listSystemAudioSources,
  connectSystemAudioSource,
  disconnectSystemAudioSource,
} from './macos-audio-utils.js';

const host = () => ({
  listAppSources: vi.fn(async () => [{ deviceId: 'app:pid:42', label: 'Google Chrome' }]),
  startCapture: vi.fn(() => true),
  stopCapture: vi.fn(),
});

const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };

describe('listSystemAudioSources (macOS)', () => {
  it('keeps whole-system capture first, then the applications', async () => {
    const sources = await listSystemAudioSources({ systemVersion: '14.2', host: host() });
    expect(sources[0]).toEqual(SYSTEM);
    expect(sources.map((s) => s.deviceId)).toContain('app:pid:42');
  });

  it('still offers whole-system capture when no helper is available', async () => {
    const h = host();
    h.listAppSources.mockResolvedValue([]);
    expect(await listSystemAudioSources({ systemVersion: '14.2', host: h })).toEqual([SYSTEM]);
  });

  // Review finding: an unguarded rejection from the helper propagated out of
  // the listing, so the renderer got no sources at all - not even whole-system
  // capture, which needs no helper to work.
  it('still offers whole-system capture when the helper listing fails', async () => {
    const h = host();
    h.listAppSources.mockRejectedValue(new Error('helper crashed'));
    expect(await listSystemAudioSources({ systemVersion: '14.2', host: h })).toEqual([SYSTEM]);
  });
});

describe('connectSystemAudioSource (macOS)', () => {
  it('marks app: ids as application capture and leaves any helper alone', async () => {
    const h = host();
    expect(await connectSystemAudioSource('app:pid:42', { systemVersion: '14.2', host: h }))
      .toEqual({ success: true, capture: 'app' });
    // The helper is started later by start-app-audio-capture, not here.
    expect(h.startCapture).not.toHaveBeenCalled();
  });

  it('routes whole-system capture through the helper too', async () => {
    // A global Core Audio tap needs only the audio-capture grant, whereas
    // getDisplayMedia would also demand Screen Recording.
    const h = host();
    expect(await connectSystemAudioSource('desktop-audio-loopback', { systemVersion: '14.2', host: h }))
      .toEqual({ success: true, capture: 'app' });
  });
});

describe('macOS capture compatibility', () => {
  it.each(['12.3', '13.7.8', '14.0', '14.1.2', '', 'unknown', '14.bad', '23.2.0-Darwin'])(
    'uses loopback without listing or starting the native helper on macOS %s',
    async (systemVersion) => {
      const h = host();
      expect(await listSystemAudioSources({ host: h, systemVersion })).toEqual([SYSTEM]);
      expect(h.listAppSources).not.toHaveBeenCalled();
      expect(await connectSystemAudioSource(SYSTEM.deviceId, { host: h, systemVersion }))
        .toEqual({ success: true, capture: 'system' });
      expect(h.startCapture).not.toHaveBeenCalled();
    },
  );

  it.each(['14.2', '14.2.0', '14.10.1', '15.0', '26.2.0'])(
    'keeps native system and application capture on macOS %s',
    async (systemVersion) => {
      const h = host();
      expect(await listSystemAudioSources({ host: h, systemVersion })).toHaveLength(2);
      for (const id of [SYSTEM.deviceId, 'app:pid:42']) {
        expect(await connectSystemAudioSource(id, { host: h, systemVersion }))
          .toEqual({ success: true, capture: 'app' });
      }
    },
  );

  it('rejects a saved application selection on old macOS instead of capturing all applications', async () => {
    const h = host();
    const answer = await connectSystemAudioSource('app:pid:42', { host: h, systemVersion: '13.7.8' });
    expect(answer).toEqual({
      success: false,
      error: expect.stringMatching(/macOS 14\.2.*System Audio \(All Applications\)/),
    });
    expect(h.startCapture).not.toHaveBeenCalled();
  });
});

describe('disconnectSystemAudioSource (macOS)', () => {
  it('always stops the helper', async () => {
    const h = host();
    expect(await disconnectSystemAudioSource({ host: h })).toEqual({ success: true });
    expect(h.stopCapture).toHaveBeenCalled();
  });
});
