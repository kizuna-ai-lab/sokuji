// Per-application capture behaviour of the Windows platform module (issue #335).
//
// These inject a fake `host` rather than vi.mock'ing win-audio-host.js:
// windows-audio-utils.js is CommonJS and reaches it through require(), which
// vi.mock does not reliably intercept.
import { describe, it, expect, vi } from 'vitest';
import {
  listSystemAudioSources,
  connectSystemAudioSource,
  disconnectSystemAudioSource,
} from './windows-audio-utils.js';

const host = () => ({
  listAppSources: vi.fn(async () => [{ deviceId: 'app:pid:42', label: 'Zoom' }]),
  startCapture: vi.fn(() => true),
  stopCapture: vi.fn(),
});

const SYSTEM = { deviceId: 'desktop-audio-loopback', label: 'System Audio (All Applications)' };

describe('listSystemAudioSources (Windows)', () => {
  it('keeps whole-system capture first, then the applications', async () => {
    const sources = await listSystemAudioSources({ host: host() });
    expect(sources[0]).toEqual(SYSTEM);
    expect(sources.map((s) => s.deviceId)).toContain('app:pid:42');
  });

  it('still offers whole-system capture when no helper is available', async () => {
    const h = host();
    h.listAppSources.mockResolvedValue([]);
    expect(await listSystemAudioSources({ host: h })).toEqual([SYSTEM]);
  });
});

describe('connectSystemAudioSource (Windows)', () => {
  it('marks app: ids as application capture and leaves any helper alone', async () => {
    const h = host();
    expect(await connectSystemAudioSource('app:pid:42', { host: h }))
      .toEqual({ success: true, capture: 'app' });
    // The helper is started later by start-app-audio-capture, not here.
    expect(h.startCapture).not.toHaveBeenCalled();
  });

  it('marks the loopback id as system capture and releases a running helper', async () => {
    const h = host();
    expect(await connectSystemAudioSource('desktop-audio-loopback', { host: h }))
      .toEqual({ success: true, capture: 'system' });
    // A helper left running would keep capturing the previously chosen app.
    expect(h.stopCapture).toHaveBeenCalled();
  });
});

describe('disconnectSystemAudioSource (Windows)', () => {
  it('always stops the helper', async () => {
    const h = host();
    expect(await disconnectSystemAudioSource({ host: h })).toEqual({ success: true });
    expect(h.stopCapture).toHaveBeenCalled();
  });
});
