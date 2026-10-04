// src/stores/captionShareStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { IDLE_STATUS, useCaptionShareStore } from './captionShareStore';

const running = (viewers: number) => ({ ...IDLE_STATUS, running: true, port: 7788, selected: '192.168.1.23', viewers });

beforeEach(() => useCaptionShareStore.getState().markStopped());

describe('captionShareStore', () => {
  it('tracks the peak and whether anyone ever connected', () => {
    const s = useCaptionShareStore.getState();
    s.markStarted(1000, running(0));
    s.setStatus(running(3));
    s.setStatus(running(1));
    const now = useCaptionShareStore.getState();
    expect(now.startedAt).toBe(1000);
    expect(now.peakViewers).toBe(3);
    expect(now.everConnected).toBe(true);
    expect(now.firewallNoteSeen).toBe(true);
  });

  it('forgets the share on stop but keeps the host options for this run of the app', () => {
    const s = useCaptionShareStore.getState();
    s.setAllowSave(true);
    s.setWifiHint({ enabled: true, ssid: 'Guest' });
    s.markStarted(1, running(2));
    s.markStopped();
    const now = useCaptionShareStore.getState();
    expect(now.status).toEqual(IDLE_STATUS);
    expect(now.startedAt).toBeNull();
    expect(now.peakViewers).toBe(0);
    expect(now.allowSave).toBe(true);
    expect(now.wifiHint).toEqual({ enabled: true, ssid: 'Guest', password: '' });
  });
});
