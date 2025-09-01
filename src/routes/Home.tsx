import React, { useEffect } from 'react';
import MainLayout from '../components/MainLayout/MainLayout';
import { UserProfileProvider } from '../contexts/UserProfileContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';
import { useInitializeAudioService } from '../stores/audioStore';

export function Home() {
  const initializeAudioService = useInitializeAudioService();
  
  // Initialize audio service when component mounts
  useEffect(() => {
    console.info('[Home] Initializing audio service');
    initializeAudioService();
  }, []); // Empty dependency array - only run once on mount
  
  return (
    <UserProfileProvider>
      <SettingsProvider>
        <OnboardingProvider>
          <MainLayout />
        </OnboardingProvider>
      </SettingsProvider>
    </UserProfileProvider>
  );
}