import { create } from 'zustand';
import { isElectron } from '../utils/environment';

export type AudioSystemStatus = 'unknown' | 'ok' | 'unavailable';
export type AudioSystemReason = 'pactl-missing' | 'pulseaudio-unavailable' | 'other' | null;

interface AudioSystemState {
  status: AudioSystemStatus;
  platform: string | null;
  reason: AudioSystemReason;
  message: string | null;
  dismissed: boolean;
  retrying: boolean;
}

interface AudioSystemActions {
  retry: () => Promise<void>;
  dismiss: () => void;
  initListeners: () => void;
  cleanupListeners: () => void;
}

type AudioSystemStore = AudioSystemState & AudioSystemActions;

// Store handler reference for cleanup (mirrors updateStore.ts pattern)
let statusHandler: ((...args: any[]) => void) | null = null;

const useAudioSystemStore = create<AudioSystemStore>()((set, get) => ({
  status: 'unknown',
  platform: null,
  reason: null,
  message: null,
  dismissed: false,
  retrying: false,

  retry: async () => {
    if (!isElectron() || get().retrying) return;
    set({ retrying: true });
    try {
      await (window as any).electron?.invoke('create-virtual-speaker');
      // Result also arrives via the 'audio-status' push below; this just
      // guards against a broken IPC round trip leaving the spinner stuck.
    } catch (error) {
      console.error('[Sokuji] [AudioSystemStore] Failed to retry virtual speaker creation:', error);
    } finally {
      set({ retrying: false });
    }
  },

  dismiss: () => set({ dismissed: true }),

  initListeners: () => {
    if (!isElectron()) return;
    const electron = (window as any).electron;
    if (!electron) return;

    if (statusHandler) {
      electron.removeListener('audio-status', statusHandler);
      statusHandler = null;
    }

    // `isLiveUpdate` distinguishes a fresh push (a status change actually
    // happened, e.g. after retry) from the one-time hydration pull below
    // (just fetching whatever was last computed). Only a live update should
    // re-surface a banner the user already dismissed — otherwise every
    // remount of the listener (e.g. entering/exiting subtitle mode) would
    // silently un-dismiss a still-unresolved, already-acknowledged failure.
    const applyStatus = (data: any, isLiveUpdate: boolean) => {
      if (!data) return;
      set({
        status: data.ok ? 'ok' : 'unavailable',
        platform: data.platform ?? null,
        reason: data.reason ?? null,
        message: data.message ?? null,
        dismissed: (isLiveUpdate && !data.ok) ? false : get().dismissed,
      });
    };

    statusHandler = (data: any) => applyStatus(data, true);
    electron.receive('audio-status', statusHandler);

    // The main process may have already pushed 'audio-status' (on
    // 'did-finish-load') before this listener was registered — React mounts
    // asynchronously, so that push can easily be missed. Pull the current
    // status once now to cover that race; future changes still arrive live
    // via the push above.
    electron.invoke('get-audio-status').then((data: any) => applyStatus(data, false)).catch(() => {});
  },

  cleanupListeners: () => {
    if (!isElectron()) return;
    const electron = (window as any).electron;
    if (!electron) return;

    if (statusHandler) {
      electron.removeListener('audio-status', statusHandler);
      statusHandler = null;
    }
  },
}));

export const useAudioSystemStatus = () => useAudioSystemStore(state => state.status);
export const useAudioSystemPlatform = () => useAudioSystemStore(state => state.platform);
export const useAudioSystemReason = () => useAudioSystemStore(state => state.reason);
export const useAudioSystemMessage = () => useAudioSystemStore(state => state.message);
export const useAudioSystemDismissed = () => useAudioSystemStore(state => state.dismissed);
export const useAudioSystemRetrying = () => useAudioSystemStore(state => state.retrying);
export const useAudioSystemRetry = () => useAudioSystemStore(state => state.retry);
export const useAudioSystemDismiss = () => useAudioSystemStore(state => state.dismiss);
export const useInitAudioSystemListeners = () => useAudioSystemStore(state => state.initListeners);
export const useCleanupAudioSystemListeners = () => useAudioSystemStore(state => state.cleanupListeners);

export default useAudioSystemStore;
