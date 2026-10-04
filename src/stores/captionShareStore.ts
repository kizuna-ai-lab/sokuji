// src/stores/captionShareStore.ts
/**
 * The host side of LAN caption sharing (spec 2026-10-04 §7.4): what the
 * panel shows. Nothing here is persisted (decision 9): every option is gone
 * when Sokuji quits, and sharing is off at every launch.
 */
import { create } from 'zustand';
import type { ShareStatus, WifiHint } from '../lib/share/types';

export const IDLE_STATUS: ShareStatus = { running: false, port: null, addresses: [], selected: null, viewers: 0, addressChanged: false };

export interface ShareError { code: 'ports-busy' | 'listen-failed'; reason: string }
export type WifiHintState = WifiHint & { enabled: boolean };

export interface CaptionShareState {
  status: ShareStatus;
  busy: boolean;
  error: ShareError | null;
  allowSave: boolean;
  wifiHint: WifiHintState;
  firewallNoteSeen: boolean;
  startedAt: number | null;
  peakViewers: number;
  everConnected: boolean;
  setStatus(status: ShareStatus): void;
  setBusy(busy: boolean): void;
  setError(error: ShareError | null): void;
  setAllowSave(allow: boolean): void;
  setWifiHint(patch: Partial<WifiHintState>): void;
  markStarted(now: number, status: ShareStatus): void;
  markStopped(): void;
}

export const useCaptionShareStore = create<CaptionShareState>()((set) => ({
  status: IDLE_STATUS,
  busy: false,
  error: null,
  allowSave: false,
  wifiHint: { enabled: false, ssid: '', password: '' },
  firewallNoteSeen: false,
  startedAt: null,
  peakViewers: 0,
  everConnected: false,
  setStatus: (status) => set((s) => ({
    status,
    peakViewers: Math.max(s.peakViewers, status.viewers),
    everConnected: s.everConnected || status.viewers > 0,
  })),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setAllowSave: (allowSave) => set({ allowSave }),
  setWifiHint: (patch) => set((s) => ({ wifiHint: { ...s.wifiHint, ...patch } })),
  markStarted: (now, status) => set({
    status, startedAt: now, peakViewers: status.viewers, everConnected: status.viewers > 0, firewallNoteSeen: true, error: null,
  }),
  markStopped: () => set({ status: IDLE_STATUS, startedAt: null, peakViewers: 0, everConnected: false }),
}));
