import React from 'react';
import MainLayout from '../components/MainLayout/MainLayout';
import { UserProfileProvider } from '../contexts/UserProfileContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { AudioProvider } from '../contexts/AudioContext';
import { SessionProvider } from '../contexts/SessionContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';

export function Home() {
  return (
    <SessionProvider>
      <UserProfileProvider>
        <SettingsProvider>
          <AudioProvider>
            <OnboardingProvider>
              <MainLayout />
            </OnboardingProvider>
          </AudioProvider>
        </SettingsProvider>
      </UserProfileProvider>
    </SessionProvider>
  );
}