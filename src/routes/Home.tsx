import React, { useEffect } from 'react';
import MainLayout from '../components/MainLayout/MainLayout';
import { UserProfileProvider } from '../contexts/UserProfileContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';
import { useInitializeAudioService } from '../stores/audioStore';
import { useLoadSettings } from '../stores/settingsStore';
import { useSubtitleStore } from '../stores/subtitleStore';
import { SettingsInitializer } from '../components/SettingsInitializer/SettingsInitializer';

export function Home() {
  const initializeAudioService = useInitializeAudioService();
  const loadSettings = useLoadSettings();

  // Initialize audio service and settings when component mounts
  useEffect(() => {
    console.info('[Home] Initializing audio service');
    initializeAudioService();

    console.info('[Home] Loading settings');
    // Hydrate settingsStore and subtitleStore in parallel from persisted storage.
    Promise.all([
      loadSettings(),
      useSubtitleStore.getState().hydrate(),
    ]).catch((err) => {
      console.warn('[Home] Settings/subtitle hydration error:', err);
    });
  }, []); // Empty dependency array - only run once on mount

  return (
    <UserProfileProvider>
      <OnboardingProvider>
        <SettingsInitializer />
        <MainLayout />
      </OnboardingProvider>
    </UserProfileProvider>
  );
}
