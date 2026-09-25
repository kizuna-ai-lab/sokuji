import React, { useEffect } from 'react';
import MainLayout from '../components/MainLayout/MainLayout';
import { UserProfileProvider } from '../contexts/UserProfileContext';
import { TourProvider } from '../components/Tour/TourProvider';
import { useInitializeAudioService } from '../stores/audioStore';
import { useLoadSettings } from '../stores/settingsStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { useConversationDisplayStore } from '../stores/conversationDisplayStore';
import { useSetupStore } from '../stores/setupStore';
import { SettingsInitializer } from '../components/SettingsInitializer/SettingsInitializer';
import AuthOverlay from '../components/Auth/AuthOverlay';
import { AppSessionRoot } from '../app/AppSessionRoot';
import { loadSessionStores } from '../app/loadStores';

export function Home() {
  const initializeAudioService = useInitializeAudioService();
  const loadSettings = useLoadSettings();

  // Initialize audio service and settings when component mounts
  useEffect(() => {
    console.info('[Home] Initializing audio service');
    initializeAudioService();

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
