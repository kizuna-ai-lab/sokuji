import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSessionLocked } from '../../../app/useRun';
import type { EngineSlot } from '../../../lib/provider/types';
import { useMode } from '../../../stores/audioStore';
import { useNavigateToSettings, useSetEngineSlotTarget } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import WarningModal from '../shared/WarningModal';
import { WarningType } from '../shared/hooks';
import {
  AudioDeviceSection,
  SystemAudioSection,
  VoicePassthroughSection,
  HelpSection
} from '../sections';
import { SessionSettingsGeneral, SessionSettingsProvider } from '../ProviderArea';
import './AdvancedSettings.scss';

interface AdvancedSettingsProps {
  toggleSettings?: () => void;
  activeTab: string;
}

const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ toggleSettings, activeTab }) => {
  const { t } = useTranslation();
  const locked = useSessionLocked();
  const mode = useMode();
  // The global turn mode — used to disable VoicePassthroughSection when
  // Push-to-Translate is in effect (mutual exclusion, 1e-3 ruling 4).
  const turnMode = useTurnModeStore((s) => s.turnMode);
  const setEngineSlotTarget = useSetEngineSlotTarget();
  const navigateToSettings = useNavigateToSettings();

  // A chip on the General tab opens its slot on the Provider tab (today's `openSlot`, ProviderSection.tsx:298-301).
  const openSlot = useCallback((slot: EngineSlot) => {
    setEngineSlotTarget(slot);
    navigateToSettings('provider');
  }, [setEngineSlotTarget, navigateToSettings]);

  // Per-channel lock derivation: a section out of the mode's scope is visible
  // but disabled (greyed), so the mode picker is the master control. The mode
  // picker is locked while a run is not idle, so the audio mode is the run's
  // (spec: "State"). Monitor is in scope ONLY in pure speaker mode (mutex
  // with participant) — locked in Both/Participant before and during a run so
  // it can't be enabled where it would violate the mutex.
  const lockMic = locked && mode === 'participant';
  const lockMonitor = mode !== 'speaker';
  const lockParticipant = mode === 'speaker';

  // The monitor lock survives restarts (mode is persisted), so without a stated
  // reason the greyed section reads as broken rather than locked. Name the mode
  // through modePicker's own key so the reason and the picker segment can't
  // drift apart in a locale.
  const monitorLockedReason = t('audioPanel.monitorLockedByMode', { mode: t('modePicker.modeYou') });

  // State
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

      {locked && (
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
            {/* The pair, the turn mode, the output toggles, segmentation, the provider with its chips — same as Simple mode */}
            <SessionSettingsGeneral locked={locked} layout="advanced" onOpenSlot={openSlot} />

            {/* Help & Updates */}
            <HelpSection toggleSettings={toggleSettings} isSessionActive={locked} />
          </>
        )}

        {activeTab === 'audio' && (
          <div className="settings-section audio-section">
            <h2>{t('audioPanel.title', 'Audio Settings')}</h2>

            <AudioDeviceSection
              isSessionActive={locked}
              isLocked={lockMic}
              showMicrophone={true}
              showSpeaker={false}
            />

            <AudioDeviceSection
              isSessionActive={locked}
              isLocked={lockMonitor}
              lockedReason={lockMonitor ? monitorLockedReason : undefined}
              showMicrophone={false}
              showSpeaker={true}
            />

            <SystemAudioSection
              isSessionActive={locked}
              isLocked={lockParticipant}
            />

            <VoicePassthroughSection
              disabled={turnMode === 'push-to-translate'}
              disabledReason={t('audioPanel.passthroughManagedByPushToTranslate')}
            />
          </div>
        )}

        {activeTab === 'provider' && (
          // The picker with its chips, then the engine, then the provider's own settings (plan 1e-3b-2 ruling 15).
          <SessionSettingsProvider locked={locked} />
        )}
      </div>
    </div>
  );
};

export default AdvancedSettings;
