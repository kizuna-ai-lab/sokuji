import React, { useState, useEffect } from 'react';
import { AlertCircle, Settings, Headphones, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsSessionActive } from '../../../stores/sessionStore';
import {
  useProvider,
  useAvailableModels,
  useLoadingModels,
  useFetchAvailableModels,
  useGetProcessedSystemInstructions,
  useSettingsNavigationTarget,
  useNavigateToSettings,
} from '../../../stores/settingsStore';
import { useAudioContext } from '../../../stores/audioStore';
import { ProviderConfigFactory } from '../../../services/providers/ProviderConfigFactory';
import { Provider } from '../../../types/Provider';
import WarningModal from '../shared/WarningModal';
import { WarningType } from '../shared/hooks';
import TabBar, { Tab } from '../shared/TabBar';
import {
  AccountSection,
  ProviderSection,
  LanguageSection,
  AudioDeviceSection,
  SystemAudioSection,
  VoicePassthroughSection,
  HelpSection
} from '../sections';
import ProviderSpecificSettings from '../sections/ProviderSpecificSettings';
import './AdvancedSettings.scss';

const TABS: Tab[] = [
  { id: 'general', labelKey: 'settings.tabs.general', fallback: 'General', icon: Settings },
  { id: 'audio', labelKey: 'settings.tabs.audio', fallback: 'Audio', icon: Headphones },
  { id: 'provider', labelKey: 'settings.tabs.provider', fallback: 'Provider', icon: Cpu },
];

const NAVIGATION_TAB_MAP: Record<string, string> = {
  'user-account': 'general',
  'languages': 'general',
  'microphone': 'audio',
  'speaker': 'audio',
  'system-audio': 'audio',
  'provider': 'provider',
  'api-key': 'provider', // legacy alias
  'system-instructions': 'provider',
  'voice-settings': 'provider',
  'turn-detection': 'provider',
  'model-management': 'provider',
  'model-asr': 'provider',
  'model-translation': 'provider',
  'model-tts': 'provider',
};

interface AdvancedSettingsProps {
  toggleSettings?: () => void;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ toggleSettings }) => {
  const { t } = useTranslation();
  const isSessionActive = useIsSessionActive();

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

  // Navigation target for scroll-to-section
  const settingsNavigationTarget = useSettingsNavigationTarget();
  const navigateToSettings = useNavigateToSettings();

  // State
  const [activeTab, setActiveTab] = useState('general');
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [warningType, setWarningType] = useState<WarningType | null>(null);

  // Handle scrolling and highlighting when settingsNavigationTarget changes
  useEffect(() => {
    if (settingsNavigationTarget) {
      const targetTab = NAVIGATION_TAB_MAP[settingsNavigationTarget];
      if (targetTab && targetTab !== activeTab) {
        setActiveTab(targetTab);
      }

      // Wait for tab switch + DOM update before scrolling
      setTimeout(() => {
        const element = document.getElementById(`${settingsNavigationTarget}-section`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          element.classList.add('highlight');
          setTimeout(() => {
            element.classList.remove('highlight');
            navigateToSettings(null);
          }, 3000);
        }
      }, 150);
    }
  }, [settingsNavigationTarget, navigateToSettings]);

  return (
    <div className="advanced-settings">
      <WarningModal
        isOpen={warningType !== null}
        onClose={() => setWarningType(null)}
        type={warningType}
      />

      {isSessionActive && (
        <div className="session-active-notice">
          <AlertCircle size={16} />
          <span>{t('settings.sessionActiveNotice', 'Settings are locked while session is active. Please end the session to modify settings.')}</span>
        </div>
      )}

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <div
        className="settings-content"
        key={activeTab}
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {activeTab === 'general' && (
          <>
            {/* User Account Section */}
            <AccountSection />

            {/* Interface Language - full list */}
            <LanguageSection
              isSessionActive={isSessionActive}
              showInterfaceLanguage={true}
              showTranslationLanguages={false}
              simplifiedInterfaceList={false}
            />

            {/* Translation Languages - same as Simple mode */}
            <LanguageSection
              isSessionActive={isSessionActive}
              showInterfaceLanguage={false}
              showTranslationLanguages={true}
            />

            {/* Provider Selection */}
            <ProviderSection
              isSessionActive={isSessionActive}
              expandableStyle={false}
            />

            {/* Help & Updates */}
            <HelpSection toggleSettings={toggleSettings} />
          </>
        )}

        {activeTab === 'audio' && (
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
        )}

        {activeTab === 'provider' && (
          <>
            {/* Provider and API Key - dropdown style */}
            <ProviderSection
              isSessionActive={isSessionActive}
              expandableStyle={false}
              showExperimentalBadge={true}
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
          </>
        )}
      </div>
    </div>
  );
};

export default AdvancedSettings;
