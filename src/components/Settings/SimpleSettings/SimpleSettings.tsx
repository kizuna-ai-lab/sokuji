import React, { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsSessionActive, useLockedMode } from '../../../stores/sessionStore';
import { useMode } from '../../../stores/audioStore';
import { useNavigateToSettings, useSettingsNavigationTarget } from '../../../stores/settingsStore';
import {
  AccountSection,
  ProviderSection,
  LanguageSection,
  AudioDeviceSection,
  SystemAudioSection,
  HelpSection
} from '../sections';
import './SimpleSettings.scss';

interface SimpleSettingsProps {
  /** Callback to highlight a specific section */
  highlightSection?: string | null;
}

const SimpleSettings: React.FC<SimpleSettingsProps> = ({ highlightSection }) => {
  const { t } = useTranslation();
  const isSessionActive = useIsSessionActive();
  const lockedMode = useLockedMode();
  const mode = useMode();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();

  // Per-channel lock derivation. A section is locked (greyed/disabled) when
  // its channel is out of the mode's scope, so the mode picker is the master
  // control. The monitor <-> participant mutual exclusivity is enforced by
  // mode scope: monitor is in scope ONLY in pure speaker mode, and its
  // playback is mode-gated at session init and on every mode switch (see
  // audioStore setMode / initializeAudioService) — locking the section here
  // keeps the UI from offering a toggle that can't take effect.
  const lockMic = isSessionActive && lockedMode !== 'speaker' && lockedMode !== 'both';
  // Participant toggle is disabled whenever participant is out of the effective
  // mode scope, so the mode picker is the master control. Pre-session this means
  // Speaker mode disables it; in-session the locked mode governs.
  const effectiveMode = lockedMode ?? mode;
  // Monitor is in scope ONLY in pure speaker mode (mutex with participant) —
  // locked in Both/Participant pre- and in-session so it can't be enabled
  // where it would violate the mutex.
  const lockMonitor = effectiveMode !== 'speaker';
  const lockParticipant = effectiveMode !== 'participant' && effectiveMode !== 'both';

  // The monitor lock survives restarts (mode is persisted), so without a stated
  // reason the greyed section reads as broken rather than locked. Name the mode
  // through modePicker's own key so the reason and the picker segment can't
  // drift apart in a locale.
  const monitorLockedReason = t('audioPanel.monitorLockedByMode', { mode: t('modePicker.modeYou') });

  // Handle scrolling and highlighting when highlightSection or settingsNavigationTarget changes
  useEffect(() => {
    const targetSection = highlightSection || settingsNavigationTarget;
    if (targetSection) {
      setTimeout(() => {
        const sectionId = `${targetSection}-section`;
        const element = document.getElementById(sectionId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('highlight');
          setTimeout(() => {
            element.classList.remove('highlight');
            navigateToSettings(null);
          }, 3000);
        }
      }, 100);
    }
  }, [highlightSection, settingsNavigationTarget, navigateToSettings]);

  return (
    <div className="simple-settings">
      <div className="settings-content">
        {isSessionActive && (
          <div className="session-warning">
            <AlertCircle size={16} />
            <span>{t('settings.sessionActiveNotice')}</span>
          </div>
        )}

        {/* User Account Section */}
        <AccountSection />

        {/* Interface Language - simplified list */}
        <LanguageSection
          isSessionActive={isSessionActive}
          showInterfaceLanguage={true}
          showTranslationLanguages={false}
          simplifiedInterfaceList={true}
        />

        {/* Translation Languages */}
        <LanguageSection
          isSessionActive={isSessionActive}
          showInterfaceLanguage={false}
          showTranslationLanguages={true}
        />

        {/* Provider and API Key */}
        <ProviderSection
          isSessionActive={isSessionActive}
        />

        {/* Microphone */}
        <AudioDeviceSection
          isSessionActive={isSessionActive}
          isLocked={lockMic}
          showMicrophone={true}
          showSpeaker={false}
        />

        {/* Speaker monitor */}
        <AudioDeviceSection
          isSessionActive={isSessionActive}
          isLocked={lockMonitor}
          lockedReason={lockMonitor ? monitorLockedReason : undefined}
          showMicrophone={false}
          showSpeaker={true}
        />

        {/* Participant audio (system audio capture) */}
        <SystemAudioSection
          isSessionActive={isSessionActive}
          isLocked={lockParticipant}
        />

        {/* Help & Updates */}
        <HelpSection />
      </div>
    </div>
  );
};

export default SimpleSettings;
