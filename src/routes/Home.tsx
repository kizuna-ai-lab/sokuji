import React, { useEffect } from 'react';
import MainLayout from '../components/MainLayout/MainLayout';
import { OnboardingProvider } from '../contexts/OnboardingContext';
import { useInitializeAudioService } from '../stores/audioStore';
import { useLoadSettings } from '../stores/settingsStore';
import { SettingsInitializer } from '../components/SettingsInitializer/SettingsInitializer';

export function Home() {
  const initializeAudioService = useInitializeAudioService();
  const loadSettings = useLoadSettings();

  // Initialize audio service and settings when component mounts
  useEffect(() => {
    console.info('[Home] Initializing audio service');
    initializeAudioService();

    console.info('[Home] Loading settings');
    loadSettings();
  }, []); // Empty dependency array - only run once on mount

  return (
    <OnboardingProvider>
      <SettingsInitializer />
      <MainLayout />
    </OnboardingProvider>
  );
}
