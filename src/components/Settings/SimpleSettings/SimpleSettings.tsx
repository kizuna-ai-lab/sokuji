import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsSessionActive } from '../../../stores/sessionStore';
import { useNavigateToSettings, useSettingsNavigationTarget } from '../../../stores/settingsStore';
import { useAudioContext } from '../../../stores/audioStore';
import WarningModal from '../shared/WarningModal';
import { WarningType } from '../shared/hooks';
import {
  AccountSection,
  ProviderSection,
  LanguageSection,
  AudioDeviceSection,
  SystemAudioSection
} from '../sections';
import './SimpleSettings.scss';

interface SimpleSettingsProps {
  /** Callback to highlight a specific section */
  highlightSection?: string | null;
}

const SimpleSettings: React.FC<SimpleSettingsProps> = ({ highlightSection }) => {
  const { t } = useTranslation();
  const isSessionActive = useIsSessionActive();
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();

  const { isSystemAudioCaptureEnabled, isMonitorDeviceOn } = useAudioContext();

  // Warning modal state for mutual exclusivity
  const [warningType, setWarningType] = useState<WarningType | null>(null);

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
      <WarningModal
        isOpen={warningType !== null}
        onClose={() => setWarningType(null)}
        type={warningType}
      />

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

        {/* Provider and API Key - expandable style */}
        <ProviderSection
          isSessionActive={isSessionActive}
          expandableStyle={true}
        />

        {/* Microphone Selection */}
        <AudioDeviceSection
          isSessionActive={isSessionActive}
          showMicrophone={true}
          showSpeaker={false}
        />

        {/* Speaker Selection */}
        <AudioDeviceSection
          isSessionActive={isSessionActive}
          showMicrophone={false}
          showSpeaker={true}
          isSystemAudioEnabled={isSystemAudioCaptureEnabled}
          onSpeakerMutualExclusivity={() => setWarningType('mutual-exclusivity-speaker')}
        />

        {/* System Audio / Participant Audio */}
        <SystemAudioSection
          isSessionActive={isSessionActive}
          isMonitorDeviceOn={isMonitorDeviceOn}
          onMutualExclusivity={() => setWarningType('mutual-exclusivity-participant')}
        />
      </div>
    </div>
  );
};

export default SimpleSettings;
