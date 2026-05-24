import React, { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsSessionActive, useLockedMode } from '../../../stores/sessionStore';
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
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();

  // Per-channel lock derivation. A section is locked (greyed/disabled) when:
  //   - the session is active, AND
  //   - the channel isn't part of the locked mode
  // Pre-session every channel is editable (lock = false). In-session,
  // irrelevant channels are still visible but disabled. The mutual
  // exclusivity between monitor and participant is enforced by the mode
  // itself (monitor is out-of-scope in participant/both modes) — no
  // runtime toggle interception needed.
  const lockMic = isSessionActive && lockedMode !== 'speaker' && lockedMode !== 'both';
  const lockParticipant = isSessionActive && lockedMode !== 'participant' && lockedMode !== 'both';
  const lockMonitor = isSessionActive && lockedMode !== 'speaker' && lockedMode !== 'both';

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
