import React, { useEffect, useState, lazy, Suspense } from 'react';
import MainLayout from '../components/MainLayout/MainLayout';
import { UserProfileProvider } from '../contexts/UserProfileContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';
import { useInitializeAudioService } from '../stores/audioStore';
import { useLoadSettings } from '../stores/settingsStore';
import { SettingsInitializer } from '../components/SettingsInitializer/SettingsInitializer';

const WhisperProto = lazy(() => import('../lib/local-inference/WhisperProto').then(m => ({ default: m.WhisperProto })));

export function Home() {
  const initializeAudioService = useInitializeAudioService();
  const loadSettings = useLoadSettings();
  const [showWhisperProto, setShowWhisperProto] = useState(false);

  // Initialize audio service and settings when component mounts
  useEffect(() => {
    console.info('[Home] Initializing audio service');
    initializeAudioService();

    console.info('[Home] Loading settings');
    loadSettings();
  }, []); // Empty dependency array - only run once on mount

  // Dev toggle: Ctrl+Shift+W for Whisper proto
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        setShowWhisperProto(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <UserProfileProvider>
      <OnboardingProvider>
        <SettingsInitializer />
        <MainLayout />
        {showWhisperProto && (
          <div style={{
            position: 'fixed', top: 20, right: 20, zIndex: 99999,
            maxHeight: 'calc(100vh - 40px)', overflow: 'auto',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)', borderRadius: 8,
          }}>
            <Suspense fallback={<div style={{ padding: 16, color: '#888' }}>Loading proto...</div>}>
              <WhisperProto />
            </Suspense>
          </div>
        )}
      </OnboardingProvider>
    </UserProfileProvider>
  );
}