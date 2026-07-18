import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsSessionActive, useLockedMode } from '../../../stores/sessionStore';
import { useMode } from '../../../stores/audioStore';
import {
  useProvider,
  useAvailableModels,
  useLoadingModels,
  useFetchAvailableModels,
  useGetProcessedSystemInstructions,
  useCurrentTurnDetectionMode,
} from '../../../stores/settingsStore';
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
  VoicePassthroughSection,
  HelpSection
} from '../sections';
import ProviderSpecificSettings from '../sections/ProviderSpecificSettings';
import './AdvancedSettings.scss';

interface AdvancedSettingsProps {
  toggleSettings?: () => void;
  activeTab: string;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ toggleSettings, activeTab }) => {
  const { t } = useTranslation();
  const isSessionActive = useIsSessionActive();

  // Provider settings
  const provider = useProvider();
  const availableModels = useAvailableModels();
  const loadingModels = useLoadingModels();
  const fetchAvailableModels = useFetchAvailableModels();
  const getProcessedSystemInstructions = useGetProcessedSystemInstructions();

  // Locked mode (sessionStore) — drives which audio channel sections are
  // editable in-session. Pre-session: all 3 editable. In-session: the
  // irrelevant channels are visible but disabled (greyed).
  const lockedMode = useLockedMode();
  const mode = useMode();
  const lockMic = isSessionActive && lockedMode !== 'speaker' && lockedMode !== 'both';
  // Participant toggle is disabled whenever participant is out of the effective
  // mode scope, so the mode picker is the master control. Pre-session this means
  // Speaker mode disables it; in-session the locked mode governs.
  const effectiveMode = lockedMode ?? mode;
  // Monitor is in scope ONLY in pure speaker mode (mutex with participant) —
  // locked in Both/Participant pre- and in-session so it can't be enabled
  // where it would violate the mutex. Its playback is mode-gated in audioStore
  // (setMode / initializeAudioService).
  const lockMonitor = effectiveMode !== 'speaker';
  const lockParticipant = effectiveMode !== 'participant' && effectiveMode !== 'both';

  // The monitor lock survives restarts (mode is persisted), so without a stated
  // reason the greyed section reads as broken rather than locked. Name the mode
  // through modePicker's own key so the reason and the picker segment can't
  // drift apart in a locale.
  const monitorLockedReason = t('audioPanel.monitorLockedByMode', { mode: t('modePicker.modeYou') });

  // Current Speech Mode for active provider — used to disable VoicePassthroughSection
  // when Push-to-Translate is in effect (mutual exclusion).
  const currentTurnDetectionMode = useCurrentTurnDetectionMode();

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

  // Close the warning modal when the panel hides (<Activity> cleanup) so it
  // can't linger open invisibly and block the visible panel's Escape key.
  useEffect(() => () => setWarningType(null), []);

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
              isLocked={lockMic}
              showMicrophone={true}
              showSpeaker={false}
            />

            <AudioDeviceSection
              isSessionActive={isSessionActive}
              isLocked={lockMonitor}
              lockedReason={lockMonitor ? monitorLockedReason : undefined}
              showMicrophone={false}
              showSpeaker={true}
            />

            <SystemAudioSection
              isSessionActive={isSessionActive}
              isLocked={lockParticipant}
            />

            <VoicePassthroughSection
              disabled={currentTurnDetectionMode === 'Push-to-Translate'}
              disabledReason={t('audioPanel.passthroughManagedByPushToTranslate')}
            />
          </div>
        )}

        {activeTab === 'provider' && (
          <>
            {/* Provider and API Key */}
            <ProviderSection
              isSessionActive={isSessionActive}
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
