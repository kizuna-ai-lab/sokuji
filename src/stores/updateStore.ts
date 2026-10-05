import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { isElectron } from '../utils/environment';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';

/** The status an `error` interrupted, as far as the banner cares (Ruling 9). */
export type UpdateErrorFrom = 'checking' | 'downloading' | 'downloaded';

interface UpdateState {
  status: UpdateStatus;
  newVersion: string | null;
  changelog: string | null;
  downloadProgress: number;
  downloadSpeed: number;
  downloadTransferred: number;
  downloadTotal: number;
  errorMessage: string | null;
  downloadUrl: string | null;
  // NEW fields for Linux AppImage/deb split:
  supportsAutoUpdate: boolean;
  appImageUrl: string | null;
  debUrl: string | null;
  releasePageUrl: string | null;
  bannerDismissed: boolean;
  dialogOpen: boolean;
  /**
   * What the current `error` interrupted, in memory: a failed download draws the
   * `available` banner again, a failed install keeps `downloaded` (spec
   * 2026-10-05 §4). Null for any other status, or an error that interrupted
   * none of these.
   */
  errorFrom: UpdateErrorFrom | null;
}

interface UpdateActions {
  checkForUpdates: () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
  dismissBanner: () => void;
  openDialog: () => void;
  closeDialog: () => void;
  initListeners: () => void;
  cleanupListeners: () => void;
}

type UpdateStore = UpdateState & UpdateActions;

// Store handler references for cleanup
let statusHandler: ((...args: any[]) => void) | null = null;
let progressHandler: ((...args: any[]) => void) | null = null;

const useUpdateStore = create<UpdateStore>()(
  subscribeWithSelector((set, get) => ({
    // State
    status: 'idle',
    newVersion: null,
    changelog: null,
    downloadProgress: 0,
    downloadSpeed: 0,
    downloadTransferred: 0,
    downloadTotal: 0,
    errorMessage: null,
    downloadUrl: null,
    supportsAutoUpdate: true,
    appImageUrl: null,
    debUrl: null,
    releasePageUrl: null,
    bannerDismissed: false,
    dialogOpen: false,
    errorFrom: null,

    // Actions
    checkForUpdates: () => {
      if (!isElectron()) return;
      set({ status: 'checking', bannerDismissed: false });
      (window as any).electron?.invoke('update-check');
      // Timeout: if no response in 15s, reset to idle (e.g. dev mode without AppImage)
      setTimeout(() => {
        if (get().status === 'checking') {
          set({ status: 'idle' });
        }
      }, 15_000);
    },

    downloadUpdate: () => {
      if (!isElectron()) return;
      (window as any).electron?.invoke('update-download');
    },

    installUpdate: () => {
      if (!isElectron()) return;
      (window as any).electron?.invoke('update-install');
    },

    dismissBanner: () => set({ bannerDismissed: true }),
    openDialog: () => set({ dialogOpen: true }),
    closeDialog: () => set({ dialogOpen: false }),

    initListeners: () => {
      if (!isElectron()) return;
      const electron = (window as any).electron;
      if (!electron) return;

      // Guard against duplicate registration (e.g. HMR, multiple mounts)
      if (statusHandler) {
        electron.removeListener('update-status', statusHandler);
        statusHandler = null;
      }
      if (progressHandler) {
        electron.removeListener('update-progress', progressHandler);
        progressHandler = null;
      }

      statusHandler = (data: any) => {
        const update: Partial<UpdateState> = { status: data.status };
        if (data.version) update.newVersion = data.version;
        if (data.releaseNotes !== undefined) {
          // fullChangelog=true returns [{version, note}] where note is HTML from GitHub
          if (Array.isArray(data.releaseNotes)) {
            if (data.releaseNotes.length <= 1) {
              // Single version: show notes directly (no version header needed)
              update.changelog = data.releaseNotes[0]?.note || '';
            } else {
              // Multiple versions: wrap each in a section with version header
              update.changelog = data.releaseNotes
                .map((entry: { version: string; note: string }) =>
                  `<h3>v${entry.version}</h3>${entry.note || ''}`
                )
                .join('<hr/>');
            }
          } else {
            update.changelog = data.releaseNotes;
          }
        }
        if (data.message) update.errorMessage = data.message;
        if (data.downloadUrl) update.downloadUrl = data.downloadUrl;
        if (typeof data.supportsAutoUpdate === 'boolean') update.supportsAutoUpdate = data.supportsAutoUpdate;
        if (data.appImageUrl !== undefined) update.appImageUrl = data.appImageUrl;
        if (data.debUrl !== undefined) update.debUrl = data.debUrl;
        if (data.releasePageUrl !== undefined) update.releasePageUrl = data.releasePageUrl;

        // Reset banner dismissed when new update is available
        if (data.status === 'available') {
          update.bannerDismissed = false;
        }

        // What an error interrupted; a repeated error (one failure reported twice) keeps the first's.
        if (data.status === 'error') {
          const before = get();
          if (before.status !== 'error') {
            update.errorFrom = before.status === 'checking' || before.status === 'downloading' || before.status === 'downloaded' ? before.status : null;
          }
        } else {
          update.errorFrom = null;
        }

        set(update);
      };

      progressHandler = (data: any) => {
        set({
          downloadProgress: data.percent || 0,
          downloadSpeed: data.bytesPerSecond || 0,
          downloadTransferred: data.transferred || 0,
          downloadTotal: data.total || 0,
        });
      };

      electron.receive('update-status', statusHandler);
      electron.receive('update-progress', progressHandler);
    },

    cleanupListeners: () => {
      if (!isElectron()) return;
      const electron = (window as any).electron;
      if (!electron) return;

      if (statusHandler) {
        electron.removeListener('update-status', statusHandler);
        statusHandler = null;
      }
      if (progressHandler) {
        electron.removeListener('update-progress', progressHandler);
        progressHandler = null;
      }
    },
  }))
);

// Individual selectors (following logStore.ts pattern — avoids new object refs on every render)
export const useUpdateStatus = () => useUpdateStore(state => state.status);
export const useUpdateNewVersion = () => useUpdateStore(state => state.newVersion);
export const useUpdateChangelog = () => useUpdateStore(state => state.changelog);
export const useUpdateProgressPercent = () => useUpdateStore(state => state.downloadProgress);
export const useUpdateProgressSpeed = () => useUpdateStore(state => state.downloadSpeed);
export const useUpdateProgressTransferred = () => useUpdateStore(state => state.downloadTransferred);
export const useUpdateProgressTotal = () => useUpdateStore(state => state.downloadTotal);
export const useUpdateError = () => useUpdateStore(state => state.errorMessage);
export const useUpdateDownloadUrl = () => useUpdateStore(state => state.downloadUrl);
export const useUpdateSupportsAutoUpdate = () => useUpdateStore(state => state.supportsAutoUpdate);
export const useUpdateAppImageUrl = () => useUpdateStore(state => state.appImageUrl);
export const useUpdateDebUrl = () => useUpdateStore(state => state.debUrl);
export const useUpdateReleasePageUrl = () => useUpdateStore(state => state.releasePageUrl);
export const useUpdateBannerDismissed = () => useUpdateStore(state => state.bannerDismissed);
export const useUpdateDialogOpen = () => useUpdateStore(state => state.dialogOpen);
export const useUpdateErrorFrom = () => useUpdateStore(state => state.errorFrom);

// Individual action selectors (stable references — safe for useEffect deps)
export const useCheckForUpdates = () => useUpdateStore(state => state.checkForUpdates);
export const useDismissBanner = () => useUpdateStore(state => state.dismissBanner);
export const useOpenUpdateDialog = () => useUpdateStore(state => state.openDialog);
export const useCloseUpdateDialog = () => useUpdateStore(state => state.closeDialog);
export const useDownloadUpdate = () => useUpdateStore(state => state.downloadUpdate);
export const useInstallUpdate = () => useUpdateStore(state => state.installUpdate);
export const useInitUpdateListeners = () => useUpdateStore(state => state.initListeners);
export const useCleanupUpdateListeners = () => useUpdateStore(state => state.cleanupListeners);

// Expose store on window for dev testing (console: window.__updateStore.setState({...}))
if (import.meta.env.DEV) {
  (window as any).__updateStore = useUpdateStore;
}

export default useUpdateStore;
