import { create } from 'zustand';
import { isElectron } from '../utils/environment';
import { reportError, describeCause } from '../lib/diagnostics/report';
import useAudioStore from './audioStore';

export type AudioSystemStatus = 'unknown' | 'ok' | 'unavailable';
export type AudioSystemReason = 'pactl-missing' | 'pulseaudio-unavailable' | 'mac-driver-not-loaded' | 'mac-driver-outdated' | 'other' | null;

/** macOS: the installed driver and the one this app ships, when they differ. */
export interface DriverVersions { installed: string; bundled: string }

// The bundled driver version whose update offer the user dismissed: the offer
// comes back only for the next driver, not on every launch.
const DRIVER_UPDATE_DISMISSED_KEY = 'audioSystem.driverUpdateDismissed';

function readDismissedDriverVersion(): string | null {
  try { return localStorage.getItem(DRIVER_UPDATE_DISMISSED_KEY); } catch { return null; }
}

interface AudioSystemState {
  status: AudioSystemStatus;
  platform: string | null;
  reason: AudioSystemReason;
  message: string | null;
  dismissed: boolean;
  retrying: boolean;
  /** macOS: the driver repair (administrator prompt + Core Audio restart) is running. */
  repairing: boolean;
  /** macOS: the last repair ran but the device still did not appear. */
  repairFailed: boolean;
  /** macOS: the installed driver is not the one this app ships (in-app updates never replace it). */
  driverUpdate: DriverVersions | null;
  /** macOS: the driver update (administrator prompt + copy + Core Audio restart) is running. */
  updatingDriver: boolean;
  /** macOS: the last driver update did not complete. */
  driverUpdateFailed: boolean;
  /** The bundled driver version whose update offer was dismissed. */
  driverUpdateDismissedFor: string | null;
}

interface AudioSystemActions {
  retry: () => Promise<void>;
  /** macOS: restart Core Audio so it loads the installed driver; `prompt` is the administrator dialog's text. */
  repair: (prompt: string) => Promise<void>;
  /** macOS: install the driver this app ships over the installed one; `prompt` is the administrator dialog's text. */
  updateDriver: (prompt: string) => Promise<void>;
  /** Stop offering this driver update; the next driver version offers again. */
  dismissDriverUpdate: () => void;
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
  repairing: false,
  repairFailed: false,
  driverUpdate: null,
  updatingDriver: false,
  driverUpdateFailed: false,
  driverUpdateDismissedFor: readDismissedDriverVersion(),

  retry: async () => {
    if (!isElectron() || get().retrying) return;
    set({ retrying: true });
    try {
      await (window as any).electron?.invoke('create-virtual-speaker');
      // Result also arrives via the 'audio-status' push below; this just
      // guards against a broken IPC round trip leaving the spinner stuck.
    } catch (error) {
      reportError(
        'AudioSystemStore',
        `Failed to retry virtual speaker creation: ${describeCause(error)}`,
        { cause: error },
      );
    } finally {
      set({ retrying: false });
    }
  },

  repair: async (prompt: string) => {
    if (!isElectron() || get().repairing) return;
    set({ repairing: true, repairFailed: false });
    try {
      const result = await (window as any).electron?.invoke('repair-virtual-audio', { prompt });
      // Success arrives as a live 'audio-status' push, like retry's. A dialog the
      // user cancelled is not a failure: the banner simply stays as it was.
      if (!result?.ok && !result?.cancelled) {
        set({ repairFailed: true });
        reportError('AudioSystemStore', `The virtual microphone repair did not work: ${result?.error ?? 'no result'}`);
      }
    } catch (error) {
      set({ repairFailed: true });
      reportError(
        'AudioSystemStore',
        `Failed to repair the virtual microphone: ${describeCause(error)}`,
        { cause: error },
      );
    } finally {
      set({ repairing: false });
    }
  },

  updateDriver: async (prompt: string) => {
    if (!isElectron() || get().updatingDriver) return;
    set({ updatingDriver: true, driverUpdateFailed: false });
    try {
      const result = await (window as any).electron?.invoke('update-virtual-audio-driver', { prompt });
      // Success arrives as an 'audio-status' push without the outdated reason.
      // A dialog the user cancelled is not a failure: the offer simply stays.
      if (!result?.ok && !result?.cancelled) {
        set({ driverUpdateFailed: true });
        reportError('AudioSystemStore', `The virtual microphone driver update did not work: ${result?.error ?? 'no result'}`);
      }
    } catch (error) {
      set({ driverUpdateFailed: true });
      reportError(
        'AudioSystemStore',
        `Failed to update the virtual microphone driver: ${describeCause(error)}`,
        { cause: error },
      );
    } finally {
      set({ updatingDriver: false });
    }
  },

  dismissDriverUpdate: () => {
    const bundled = get().driverUpdate?.bundled ?? null;
    if (!bundled) return;
    try { localStorage.setItem(DRIVER_UPDATE_DISMISSED_KEY, bundled); } catch { /* the offer returns next launch */ }
    set({ driverUpdateDismissedFor: bundled });
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
      // The device list was read while the virtual device was missing, and
      // nothing else reads it again: without this, the translation reaches a
      // device a repair or retry brought back only after a restart.
      // It stays beside the `devicechange` watch: whether macOS fires that after
      // Core Audio restarts is unverified.
      const recovered = data.ok && get().status === 'unavailable';
      set({
        status: data.ok ? 'ok' : 'unavailable',
        platform: data.platform ?? null,
        reason: data.reason ?? null,
        message: data.message ?? null,
        dismissed: (isLiveUpdate && !data.ok) ? false : get().dismissed,
        driverUpdate: data.reason === 'mac-driver-outdated' && data.driverVersion?.installed && data.driverVersion?.bundled
          ? { installed: String(data.driverVersion.installed), bundled: String(data.driverVersion.bundled) }
          : null,
      });
      // A recovery is a change the OS reported: devices marked unusable while
      // it was down (a Repair restarting Core Audio mid-run) are tried again.
      if (recovered) void useAudioStore.getState().syncDevices({ retryUnusable: true });
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
export const useAudioSystemRepairing = () => useAudioSystemStore(state => state.repairing);
export const useAudioSystemRepairFailed = () => useAudioSystemStore(state => state.repairFailed);
export const useAudioSystemRepair = () => useAudioSystemStore(state => state.repair);
export const useAudioSystemDismiss = () => useAudioSystemStore(state => state.dismiss);
export const useAudioSystemDriverUpdate = () => useAudioSystemStore(state => state.driverUpdate);
export const useAudioSystemUpdatingDriver = () => useAudioSystemStore(state => state.updatingDriver);
export const useAudioSystemDriverUpdateFailed = () => useAudioSystemStore(state => state.driverUpdateFailed);
export const useAudioSystemDriverUpdateDismissedFor = () => useAudioSystemStore(state => state.driverUpdateDismissedFor);
export const useAudioSystemUpdateDriver = () => useAudioSystemStore(state => state.updateDriver);
export const useAudioSystemDismissDriverUpdate = () => useAudioSystemStore(state => state.dismissDriverUpdate);
export const useInitAudioSystemListeners = () => useAudioSystemStore(state => state.initListeners);
export const useCleanupAudioSystemListeners = () => useAudioSystemStore(state => state.cleanupListeners);

export default useAudioSystemStore;
