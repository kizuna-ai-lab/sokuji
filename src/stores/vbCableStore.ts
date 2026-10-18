// src/stores/vbCableStore.ts
//
// VB-CABLE on Windows (spec 2026-10-17 §4): which build this is, an install
// Sokuji started this session, and whether the one-time introduction was seen.
// The device's presence is not stored here: it is read from audioStore's list,
// the same one the routing reads.
import { create } from 'zustand';
import { ServiceFactory } from '../services/ServiceFactory';
import { persistSetting } from '../services/persistSetting';
import { describeCause, reportError, reportWarning } from '../lib/diagnostics/report';
import { vbCablePresence, type VbCablePresence } from '../lib/audio/vbCable';
import { isElectron, isWindows } from '../utils/environment';
import useAudioStore from './audioStore';

export const VB_CABLE_INTRO_SEEN_KEY = 'audio.vbCableIntroSeen';

export type DistributionChannel = 'website' | 'store';
/** An install Sokuji started this session; `succeeded` is main's word, the device list may lag. */
export type VbCableAttempt = 'none' | 'running' | 'failed' | 'succeeded';

export interface VbCableState {
  /** null until loaded. */
  channel: DistributionChannel | null;
  /** null until loaded; persisted. */
  introSeen: boolean | null;
  attempt: VbCableAttempt;
  /** The ready notice's ×: this session only. */
  readyDismissed: boolean;
  load: () => Promise<void>;
  install: () => Promise<void>;
  checkAgain: () => Promise<void>;
  dismissReady: () => void;
  markIntroSeen: () => void;
}

type Electron = { invoke: (channel: string, data?: unknown) => Promise<unknown> };
const electron = () => (window as unknown as { electron?: Electron }).electron;

let loading: Promise<void> | null = null;

export const useVbCableStore = create<VbCableState>()((set, get) => ({
  channel: null,
  introSeen: null,
  attempt: 'none',
  readyDismissed: false,

  load: () => {
    loading ??= (async () => {
      // Fail closed: a build that cannot say what it is offers no install.
      let channel: DistributionChannel = 'store';
      try {
        if ((await electron()?.invoke('get-distribution-channel')) === 'website') channel = 'website';
      } catch (error) {
        reportWarning('VbCableStore', `Could not read which build this is, so VB-CABLE is only linked: ${describeCause(error)}`, { cause: error });
      }
      // Fail closed again: an unreadable flag is a seen introduction, not a nag.
      let introSeen = true;
      try {
        introSeen = (await ServiceFactory.getSettingsService().getSetting<boolean | null>(VB_CABLE_INTRO_SEEN_KEY, null)) === true;
      } catch (error) {
        reportWarning('VbCableStore', `Could not read whether the VB-CABLE introduction was shown: ${describeCause(error)}`, { cause: error });
      }
      set({ channel, introSeen });
    })();
    return loading;
  },

  install: async () => {
    if (get().channel !== 'website' || get().attempt === 'running') return;
    set({ attempt: 'running', readyDismissed: false });
    let result: { ok?: boolean; reason?: string } | undefined;
    try {
      result = (await electron()?.invoke('install-vbcable')) as typeof result;
    } catch (error) {
      reportError('VbCableStore', `VB-CABLE could not be installed: ${describeCause(error)}`, { cause: error });
    }
    if (result?.ok) {
      set({ attempt: 'succeeded' });
    } else {
      set({ attempt: 'failed' });
      // A declined administrator prompt is the user's choice, not a failure.
      if (result && result.reason !== 'cancelled') reportError('VbCableStore', `VB-CABLE was not installed: ${result.reason ?? 'no reason given'}`);
    }
    await useAudioStore.getState().syncDevices();
  },

  checkAgain: () => useAudioStore.getState().syncDevices(),

  dismissReady: () => set({ readyDismissed: true }),

  markIntroSeen: () => {
    set({ introSeen: true });
    void persistSetting(VB_CABLE_INTRO_SEEN_KEY, true);
  },
}));

/** VB-CABLE's presence, following the device list. */
export function useVbCablePresence(): VbCablePresence {
  const devicesLoaded = useAudioStore((s) => s.devicesLoaded);
  const outputs = useAudioStore((s) => s.audioMonitorDevices);
  return vbCablePresence({ electron: isElectron(), windows: isWindows(), devicesLoaded, outputs });
}
