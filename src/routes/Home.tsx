import React, { useEffect } from 'react';
import MainLayout from '../components/MainLayout/MainLayout';
import { UserProfileProvider } from '../contexts/UserProfileContext';
import { TourProvider } from '../components/Tour/TourProvider';
import useAudioStore from '../stores/audioStore';
import { useLoadSettings } from '../stores/settingsStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { useConversationDisplayStore } from '../stores/conversationDisplayStore';
import { useSetupStore } from '../stores/setupStore';
import { SettingsInitializer } from '../components/SettingsInitializer/SettingsInitializer';
import AuthOverlay from '../components/Auth/AuthOverlay';
import { AppSessionRoot } from '../app/AppSessionRoot';
import { loadSessionStores } from '../app/loadStores';
import { watchDevices } from '../lib/audio/deviceWatch';
import { requestForSync, startNativeOutputs } from '../lib/audio/nativeOutputs';
import { bindReadings } from '../app/readings';
import { isElectron } from '../utils/environment';

export function Home() {
  const loadSettings = useLoadSettings();

  // Refresh audio devices and load settings when component mounts
  useEffect(() => {
    // What the system says each output is (spec 2026-11-05 §6), joined into the
    // device list by a sync whenever the answer changes; stale reads unknown
    // at once. Electron only: the extension runs this page too, but has no
    // main process to ask.
    const native = isElectron() && window.electron
      ? startNativeOutputs(() => useAudioStore.getState().nativeOutputsChanged())
      : null;

    console.info('[Home] Refreshing audio devices');
    // The first answer can land while this refresh still loads the saved
    // devices, when a sync does nothing: one more sync after it picks it up.
    void useAudioStore.getState().refreshDevices().then(() => {
      if (native) void useAudioStore.getState().syncDevices();
    });

    console.info('[Home] Loading settings');
    // Hydrate settingsStore, subtitleStore, conversationDisplayStore, and setup in parallel from persisted storage.
    Promise.all([
      loadSettings(),
      useSubtitleStore.getState().hydrate(),
      useConversationDisplayStore.getState().hydrate(),
      useSetupStore.getState().hydrate(),
    ]).catch((err) => {
      console.warn('[Home] Settings/subtitle/conversationDisplay/setup hydration error:', err);
    });

    // The app session's stores: the stored provider selected and loaded, the
    // turn mode migrated, the routing switches, the punctuation pack — read by
    // the session from the first Start.
    void loadSessionStores();

    // Japanese readings are wanted while a readings switch is on and the target includes Japanese (spec 2026-10-15 §3).
    const unbindReadings = bindReadings();

    // Follow the OS's devices from here on (spec 2026-10-04): plugging,
    // unplugging, a Bluetooth reconnect, a repaired virtual device.
    const stopWatching = watchDevices({
      // A `devicechange` also tries the devices marked unusable again, and reads
      // the system's list again; the poll does neither.
      sync: (reason) => {
        requestForSync(native, reason);
        return useAudioStore.getState().syncDevices({ retryUnusable: reason === 'change' });
      },
      // While waiting for any microphone or while off the user's own: keep
      // looking. Linux announces a USB device but not a Bluetooth or PipeWire
      // one coming back, so without this it would never switch back or leave
      // waiting. Each beat is only a device listing, so polling can run for as
      // long as needed. A selection still on a device marked unusable counts
      // too: after a failed open, a sync whose listing failed or came back
      // incomplete leaves it there, and without another devicechange only the
      // poll would ever move it on.
      shouldPoll: () => {
        const audio = useAudioStore.getState();
        const selected = audio.selectedInputDevice;
        return selected === null
          || (audio.savedInputDeviceId !== null && selected.deviceId !== audio.savedInputDeviceId)
          || audio.unusableInputIds.includes(selected.deviceId);
      },
    });
    return () => {
      stopWatching();
      native?.dispose();
      unbindReadings();
    };
  }, []); // Empty dependency array - only run once on mount

  return (
    <UserProfileProvider>
      <TourProvider>
        {/* The app session's page wiring; inside UserProfileProvider, which it reads. */}
        <AppSessionRoot />
        <SettingsInitializer />
        <MainLayout />
        {/* Over the app, not instead of it: MainLayout and every provider above
            it stay mounted while the user signs in, so a running translation
            session survives the round trip. */}
        <AuthOverlay />
      </TourProvider>
    </UserProfileProvider>
  );
}
