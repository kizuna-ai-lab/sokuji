import React from 'react';
import MainLayout from '../components/MainLayout/MainLayout';
import { UserProfileProvider } from '../contexts/UserProfileContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { LogProvider } from '../contexts/LogContext';
import { AudioProvider } from '../contexts/AudioContext';
import { SessionProvider } from '../contexts/SessionContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';

export function Home() {
  return (
    <SessionProvider>
      <UserProfileProvider>
          <SettingsProvider>
            <LogProvider>
              <AudioProvider>
                <OnboardingProvider>
                  <MainLayout />
                </OnboardingProvider>
              </AudioProvider>
            </LogProvider>
          </SettingsProvider>
      </UserProfileProvider>
    </SessionProvider>
  );
}