import React, { useState } from 'react';
import { AlertCircle, HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsSessionActive } from '../../../stores/sessionStore';
import { useOnboarding } from '../../../contexts/OnboardingContext';
import {
  useProvider,
  useAvailableModels,
  useLoadingModels,
  useFetchAvailableModels,
  useGetProcessedSystemInstructions
} from '../../../stores/settingsStore';
import { useAudioContext } from '../../../stores/audioStore';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { Provider } from '../../../types/Provider';
import WarningModal from '../shared/WarningModal';
import { WarningType } from '../shared/hooks';
import {
  AccountSection,
  ProviderSection,
  LanguageSection,
  AudioDeviceSection,
  SystemAudioSection,
  VoicePassthroughSection
} from '../sections';
import ProviderSpecificSettings from '../sections/ProviderSpecificSettings';
import './AdvancedSettings.scss';

interface AdvancedSettingsProps {
  toggleSettings?: () => void;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ toggleSettings }) => {
  const { t } = useTranslation();
  const isSessionActive = useIsSessionActive();
  const { startOnboarding } = useOnboarding();

  // Provider settings
  const provider = useProvider();
  const availableModels = useAvailableModels();
  const loadingModels = useLoadingModels();
  const fetchAvailableModels = useFetchAvailableModels();
  const getProcessedSystemInstructions = useGetProcessedSystemInstructions();

  // Audio context
  const { isSystemAudioCaptureEnabled, isMonitorDeviceOn } = useAudioContext();

  // Get current provider configuration
  const currentProviderConfig = React.useMemo(() => {
    try {
      return ProviderConfigFactory.getConfig(provider || Provider.OPENAI);
    } catch (error) {
      console.warn(`[AdvancedSettings] Unknown provider: ${provider}, falling back to OpenAI`);
      return ProviderConfigFactory.getConfig(Provider.OPENAI);
    }
  }, [provider]);

  // State
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [warningType, setWarningType] = useState<WarningType | null>(null);

  return (
    <div className="advanced-settings">
      <WarningModal
        isOpen={warningType !== null}
        onClose={() => setWarningType(null)}
        type={warningType}
      />

      <div className="settings-content">
        {isSessionActive && (
          <div className="session-active-notice">
            <AlertCircle size={16} />
            <span>{t('settings.sessionActiveNotice', 'Settings are locked while session is active. Please end the session to modify settings.')}</span>
          </div>
        )}

        {/* User Account Section */}
        <AccountSection />

        {/* Provider and API Key - dropdown style */}
        <ProviderSection
          isSessionActive={isSessionActive}
          expandableStyle={false}
          showExperimentalBadge={true}
        />

        {/* Interface Language - full list */}
        <LanguageSection
          isSessionActive={isSessionActive}
          showInterfaceLanguage={true}
          showTranslationLanguages={false}
          simplifiedInterfaceList={false}
        />

        {/* Provider-specific settings (system instructions, model, turn detection, etc.) */}
        <ProviderSpecificSettings
          config={currentProviderConfig}
          isSessionActive={isSessionActive}
          isPreviewExpanded={isPreviewExpanded}
          setIsPreviewExpanded={setIsPreviewExpanded}
          getProcessedSystemInstructions={getProcessedSystemInstructions}
          availableModels={availableModels}
          loadingModels={loadingModels}
          fetchAvailableModels={fetchAvailableModels}
        />

        {/* Audio Input Devices */}
        <div className="settings-section audio-section">
          <h2>{t('audioPanel.title', 'Audio Settings')}</h2>

          <AudioDeviceSection
            isSessionActive={isSessionActive}
            showMicrophone={true}
            showSpeaker={false}
          />

          <AudioDeviceSection
            isSessionActive={isSessionActive}
            showMicrophone={false}
            showSpeaker={true}
            isSystemAudioEnabled={isSystemAudioCaptureEnabled}
            onSpeakerMutualExclusivity={() => setWarningType('mutual-exclusivity-speaker')}
          />

          <SystemAudioSection
            isSessionActive={isSessionActive}
            isMonitorDeviceOn={isMonitorDeviceOn}
            onMutualExclusivity={() => setWarningType('mutual-exclusivity-participant')}
          />

          <VoicePassthroughSection />
        </div>

        {/* Help Section */}
        <div className="settings-section">
          <h2>{t('settings.help', 'Help')}</h2>
          <div className="setting-item">
            <button
              className="restart-onboarding-button"
              onClick={() => {
                startOnboarding();
                if (toggleSettings) {
                  toggleSettings();
                }
              }}
            >
              <HelpCircle size={16} />
              <span>{t('onboarding.restartTour', 'Restart Setup Guide')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdvancedSettings;
